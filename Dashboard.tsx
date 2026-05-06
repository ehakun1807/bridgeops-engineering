// ---------------------------------------------------------------------------
// Dashboard — SaaS workspace for BridgeOps Professional.
//
// Views:
//   1. Active Projects  → list of projects currently in ramp-up tracking.
//   2. Archive          → projects marked Completed or Cancelled (read-only).
//   3. Project Deep Dive → opens when a project is selected. Shows the
//                           4 parent parameter groups with measurable items.
//
// Auth-gated: unauthenticated users see a sign-in prompt rather than silent
// failure when they try to create or open a project.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { db, auth } from './firebase.ts';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  TrendingUp,
  Calendar,
  Loader2,
  Plus,
  FolderKanban,
  Archive,
  ChevronRight,
  ShieldCheck,
  LogIn,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Rocket,
  GraduationCap,
  ChevronDown,
  Trash2,
  Wrench
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ProjectDeepDive, {
  DeepDiveProject,
  InfoStatus,
  ProductGate,
  ProjectAttachment,
  ScoreSnapshot,
  SubItemDeliverables,
  CustomSubItem
} from './ProjectDeepDive';
import PortfolioHeatmap from './PortfolioHeatmap.tsx';
import AuthModal from './AuthModal.tsx';
import AdvancedToolsModal from './AdvancedToolsModal.tsx';
import BridgeOpsAcademy from './BridgeOpsAcademy.tsx';
import {
  scoreBand,
  scoreForProject,
  defaultMetricValues,
  deriveDeliverableScores,
  effectiveMetrics
} from './rampGroups';
import {
  PROJECT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  disabledIdsForTemplate,
  TOTAL_ITEM_COUNT
} from './templates';
import {
  PRODUCT_SEGMENTS,
  PRODUCT_SEGMENT_OTHER
} from './productSegments.ts';
import StandardsPicker from './StandardsPicker.tsx';

interface ProjectRecord {
  id: string;
  userId: string;
  name: string;
  description?: string;
  productType?: string;
  // Applicable ISO / world standards the user flagged as relevant to this
  // project. Feeds the Coacher prompt (so referenceStandards prioritize
  // these) and the ai-analyze risk assessment (compliance-weighted
  // findings). Absent / empty = no standards-specific weighting applied.
  // Codes come from productStandards.STANDARDS_BY_SEGMENT.
  standards?: string[];
  status: 'active' | 'archived';
  closeReason?: 'completed' | 'cancelled';
  createdAt?: Timestamp;
  closedAt?: Timestamp;
  updatedAt?: Timestamp;
  metrics?: Record<string, number>;
  notes?: Record<string, string>;
  lastScore?: number;
  startDate?: string;
  endDate?: string;
  infoStatus?: InfoStatus;
  generalInfo?: string;
  currentGate?: ProductGate;
  gateTargets?: Partial<Record<ProductGate, string>>;
  attachments?: ProjectAttachment[];
  scoreHistory?: ScoreSnapshot[];
  deliverables?: Record<string, SubItemDeliverables>;
  templateId?: string;
  disabledItemIds?: string[];
  customSubItems?: CustomSubItem[];
}

type TabKey = 'active' | 'archive' | 'academy';

const Dashboard: React.FC = () => {
  // --- Auth state --------------------------------------------------------
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // --- Data --------------------------------------------------------------
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // --- UI state ----------------------------------------------------------
  const [activeTab, setActiveTab] = useState<TabKey>('active');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // --- New Project dialog ------------------------------------------------
  // `newProjectProductChoice` holds either one of PRODUCT_SEGMENTS or the
  // sentinel PRODUCT_SEGMENT_OTHER ("custom text"). When the sentinel is
  // selected, `newProjectProductCustom` is used as the actual productType.
  // This keeps the dropdown stateful while still supporting niche industries
  // that aren't in the canonical list.
  const [showAddProject, setShowAddProject] = useState(false);
  // Top-level Tools modal — surfaces Alt BOM / Quote Compare without
  // needing to dive into a project first. Same modal as the per-project
  // entry in ProjectDeepDive's footer.
  const [showTools, setShowTools] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectProductChoice, setNewProjectProductChoice] = useState<string>(
    PRODUCT_SEGMENTS[0]
  );
  const [newProjectProductCustom, setNewProjectProductCustom] = useState('');
  // Selected standards codes for the new project. Optional — empty by
  // default so the picker doesn't get in the way of a quick project spin-up.
  // Cleared whenever the product type changes (below, inline with the
  // select onChange) since different segments have different catalogs.
  const [newProjectStandards, setNewProjectStandards] = useState<string[]>([]);
  const [newProjectTemplate, setNewProjectTemplate] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // --- Permanent deletion (archive only) --------------------------------
  // Permanent project deletion is a hard, irreversible action — we gate it
  // behind a name-match confirmation modal. The Firestore data model puts
  // every nested field (metrics, notes, deliverables, scoreHistory,
  // attachments, customSubItems, disabledItemIds) on the single project doc,
  // so deleteDoc atomically removes the project and all of its data with no
  // cascade work needed.
  const [deletingProject, setDeletingProject] = useState<ProjectRecord | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Subscribe to auth state, so the button doesn't silently fail for signed-out users.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Load projects for the current user. Resubscribe whenever user changes.
  useEffect(() => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'projects'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProjects(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProjectRecord, 'id'>) }))
        );
        setLoading(false);
      },
      (err) => {
        console.error('Projects snapshot error:', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user]);

  // Derived lists
  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'active'),
    [projects]
  );
  const archivedProjects = useMemo(
    () => projects.filter((p) => p.status === 'archived'),
    [projects]
  );

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  // ---- New project creation --------------------------------------------
  const handleAddProject = async () => {
    setCreateError(null);
    if (!newProjectName.trim()) {
      setCreateError('Project name is required.');
      return;
    }
    if (!user) {
      setCreateError('You need to be signed in to create a project.');
      setAuthModalOpen(true);
      return;
    }
    // Resolve the final productType string: either a listed segment, a
    // user-entered custom value (when 'Other' was selected), or fall back to
    // 'Hardware' if custom was selected but left blank.
    const resolvedProductType =
      newProjectProductChoice === PRODUCT_SEGMENT_OTHER
        ? newProjectProductCustom.trim() || 'Hardware'
        : newProjectProductChoice;
    setCreating(true);
    try {
      const pid = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const seedDisabled = disabledIdsForTemplate(newProjectTemplate);
      await setDoc(doc(db, 'projects', pid), {
        userId: user.uid,
        name: newProjectName.trim(),
        productType: resolvedProductType,
        // Persist standards only when the user actually picked some — avoids
        // sprinkling empty arrays across every historical project and keeps
        // the absence of the field a meaningful "not set" signal.
        ...(newProjectStandards.length > 0 && {
          standards: newProjectStandards
        }),
        status: 'active',
        metrics: defaultMetricValues(),
        lastScore: scoreForProject(defaultMetricValues(), seedDisabled),
        templateId: newProjectTemplate,
        disabledItemIds: seedDisabled,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      // Reset + open the new project in deep-dive.
      setNewProjectName('');
      setNewProjectProductChoice(PRODUCT_SEGMENTS[0]);
      setNewProjectProductCustom('');
      setNewProjectStandards([]);
      setNewProjectTemplate(DEFAULT_TEMPLATE_ID);
      setShowAddProject(false);
      setActiveTab('active');
      setSelectedProjectId(pid);
    } catch (err: any) {
      console.error('Create project failed:', err);
      setCreateError(
        err?.code === 'permission-denied'
          ? 'Permission denied — your account may not be authorized yet.'
          : err?.message || 'Could not create the project. Please retry.'
      );
    } finally {
      setCreating(false);
    }
  };

  // ---- Permanent project deletion --------------------------------------
  // Requires the user to type the project name as a confirmation gesture.
  // The active onSnapshot subscription auto-removes the row from UI on
  // successful delete; no manual list mutation needed.
  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    setDeleteError(null);
    if (deleteConfirmText.trim() !== deletingProject.name.trim()) {
      setDeleteError('Project name does not match. Type the exact name to confirm.');
      return;
    }
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'projects', deletingProject.id));
      setDeletingProject(null);
      setDeleteConfirmText('');
    } catch (err: any) {
      console.error('Delete project failed:', err);
      setDeleteError(
        err?.code === 'permission-denied'
          ? 'Permission denied — your account may not be authorized to delete this project.'
          : err?.message || 'Could not delete the project. Please retry.'
      );
    } finally {
      setDeleting(false);
    }
  };

  // -------------------- Render guards --------------------

  if (!authReady) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-blue-600" size={40} />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <div className="inline-flex items-center justify-center p-4 bg-blue-50 rounded-full mb-6">
            <Rocket className="text-blue-600" size={36} />
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-slate-900 uppercase tracking-tighter mb-4">
            BridgeOps Professional Workspace
          </h2>
          <p className="text-slate-500 font-medium text-base leading-relaxed max-w-xl mx-auto mb-8">
            Track ramp readiness across multiple projects in parallel. Sign in to
            access your workspace, create projects, and manage action items against
            the 4 parent readiness parameters.
          </p>
          <button
            onClick={() => setAuthModalOpen(true)}
            className="bg-slate-900 text-white px-8 py-4 font-black uppercase tracking-widest text-[10px] hover:bg-blue-600 transition-all shadow-xl inline-flex items-center gap-3"
          >
            <LogIn size={14} /> Sign In / Create Account
          </button>
        </div>
        <AuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={() => setAuthModalOpen(false)}
        />
      </>
    );
  }

  // If a project is selected, take over the view with the deep dive.
  if (selectedProject) {
    const isArchived = selectedProject.status === 'archived';
    const deepDiveProject: DeepDiveProject = {
      id: selectedProject.id,
      name: selectedProject.name,
      description: selectedProject.description,
      status: isArchived
        ? 'archived'
        : selectedProject.status === 'active'
        ? 'active'
        : 'completed',
      metrics: selectedProject.metrics,
      notes: selectedProject.notes,
      productType: selectedProject.productType,
      standards: selectedProject.standards,
      startDate: selectedProject.startDate,
      endDate: selectedProject.endDate,
      infoStatus: selectedProject.infoStatus,
      generalInfo: selectedProject.generalInfo,
      currentGate: selectedProject.currentGate,
      gateTargets: selectedProject.gateTargets,
      attachments: selectedProject.attachments,
      scoreHistory: selectedProject.scoreHistory,
      deliverables: selectedProject.deliverables,
      templateId: selectedProject.templateId,
      disabledItemIds: selectedProject.disabledItemIds,
      customSubItems: selectedProject.customSubItems,
      userId: selectedProject.userId,
      createdAt: selectedProject.createdAt,
      closedAt: selectedProject.closedAt,
      closeReason: selectedProject.closeReason
    };
    return (
      <ProjectDeepDive
        project={deepDiveProject}
        onBack={() => setSelectedProjectId(null)}
        readOnly={isArchived}
      />
    );
  }

  // ---- Main list view (Active / Archive) --------------------------------
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-left">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase mb-2">
            Client Workspace
          </h2>
          <p className="text-slate-500 font-medium uppercase tracking-widest text-[10px]">
            Parallel Project Ramp Tracking · {activeProjects.length} Active ·{' '}
            {archivedProjects.length} Archived
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setCreateError(null);
              setShowAddProject(true);
            }}
            className="bg-slate-900 text-white px-6 py-3 rounded-sm shadow-sm flex items-center hover:bg-blue-600 transition-all group"
          >
            <Plus size={16} className="mr-2 group-hover:rotate-90 transition-transform" />
            <span className="text-[10px] font-black uppercase tracking-widest">
              New Project
            </span>
          </button>
          <button
            onClick={() => setShowTools(true)}
            className="bg-white border border-slate-200 text-slate-900 px-6 py-3 rounded-sm shadow-sm flex items-center hover:border-slate-900 hover:text-blue-600 transition-all"
            title="Alt BOM, Quote Compare, and other utilities"
          >
            <Wrench size={16} className="mr-2" />
            <span className="text-[10px] font-black uppercase tracking-widest">
              Tools
            </span>
          </button>
          <div className="bg-white border border-slate-200 px-6 py-3 rounded-sm shadow-sm flex items-center">
            <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
              SaaS · Active
            </span>
          </div>
        </div>
      </div>

      {/* Top-level Tools modal — same component used inside ProjectDeepDive */}
      <AdvancedToolsModal isOpen={showTools} onClose={() => setShowTools(false)} />

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-10 overflow-x-auto">
        <TabButton
          active={activeTab === 'active'}
          onClick={() => setActiveTab('active')}
          icon={<FolderKanban size={14} />}
          label="Active Projects"
          badge={activeProjects.length}
        />
        <TabButton
          active={activeTab === 'archive'}
          onClick={() => setActiveTab('archive')}
          icon={<Archive size={14} />}
          label="Archive"
          badge={archivedProjects.length}
        />
        <TabButton
          active={activeTab === 'academy'}
          onClick={() => setActiveTab('academy')}
          icon={<GraduationCap size={14} />}
          label="BridgeOps Academy"
        />
      </div>

      {activeTab === 'academy' ? (
        // Academy tab is content, not data — render immediately without the
        // loading spinner (Firestore isn't involved).
        <BridgeOpsAcademy />
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-blue-600" size={32} />
        </div>
      ) : activeTab === 'active' ? (
        <>
          {activeProjects.length > 0 && (
            <PortfolioHeatmap
              projects={activeProjects}
              onSelect={(id) => setSelectedProjectId(id)}
            />
          )}
          <ProjectList
            projects={activeProjects}
            emptyTitle="No Active Projects Yet"
            emptySubtitle="Create your first project to start tracking ramp readiness."
            emptyCta={
              <button
                onClick={() => {
                  setCreateError(null);
                  setShowAddProject(true);
                }}
                className="bg-blue-600 text-white px-8 py-4 font-black uppercase tracking-widest text-[10px] hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 inline-flex items-center gap-2"
              >
                <Plus size={14} /> Create First Project
              </button>
            }
            onSelect={(p) => setSelectedProjectId(p.id)}
          />
        </>
      ) : (
        <ProjectList
          projects={archivedProjects}
          emptyTitle="Archive Is Empty"
          emptySubtitle="Completed or cancelled projects appear here with all data preserved."
          onSelect={(p) => setSelectedProjectId(p.id)}
          onDelete={(p) => {
            setDeleteError(null);
            setDeleteConfirmText('');
            setDeletingProject(p);
          }}
          archiveMode
        />
      )}

      {/* New Project modal */}
      <AnimatePresence>
        {showAddProject && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md p-8 rounded-sm shadow-2xl space-y-5"
            >
              <div>
                <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900 mb-1">
                  Initialize New Project
                </h3>
                <p className="text-[11px] text-slate-500 font-medium">
                  A new project starts with default readiness metrics — adjust them
                  in the deep-dive view.
                </p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    Project Name
                  </label>
                  <input
                    autoFocus
                    value={newProjectName}
                    onChange={(e) => {
                      setNewProjectName(e.target.value);
                      if (createError) setCreateError(null);
                    }}
                    placeholder="e.g., Drone X1 Ramp"
                    className="w-full border border-slate-200 p-3.5 font-bold text-sm outline-none focus:border-blue-500 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    Product Type
                  </label>
                  <div className="relative">
                    <select
                      value={newProjectProductChoice}
                      onChange={(e) => {
                        setNewProjectProductChoice(e.target.value);
                        // Different segments ship different catalogs, so
                        // previously-picked codes may no longer exist in the
                        // new segment. Safest to reset the selection rather
                        // than persist codes the user can't see.
                        setNewProjectStandards([]);
                      }}
                      className="w-full appearance-none border border-slate-200 p-3.5 pr-10 font-bold text-sm outline-none focus:border-blue-500 bg-slate-50 cursor-pointer"
                    >
                      {PRODUCT_SEGMENTS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                      <option value={PRODUCT_SEGMENT_OTHER}>
                        Other (type your own)
                      </option>
                    </select>
                    <ChevronDown
                      size={14}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                    />
                  </div>
                  {newProjectProductChoice === PRODUCT_SEGMENT_OTHER && (
                    <input
                      autoFocus
                      value={newProjectProductCustom}
                      onChange={(e) => setNewProjectProductCustom(e.target.value)}
                      placeholder="Describe your product type…"
                      className="mt-2 w-full border border-slate-200 p-3.5 font-bold text-sm outline-none focus:border-blue-500 bg-slate-50"
                    />
                  )}
                </div>

                {/* Applicable Standards — catalog scoped to the selected
                    product type. Hidden for 'Other' since we have no catalog
                    for free-text segments; user can set standards later from
                    the project Deep Dive. */}
                {newProjectProductChoice !== PRODUCT_SEGMENT_OTHER && (
                  <StandardsPicker
                    productSegment={newProjectProductChoice}
                    selected={newProjectStandards}
                    onChange={setNewProjectStandards}
                  />
                )}

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    Scope Template
                  </label>
                  <div className="space-y-2">
                    {PROJECT_TEMPLATES.map((t) => {
                      const enabledCount =
                        t.id === 'custom' ? 0 : t.enabledItemIds.length;
                      const checked = t.id === newProjectTemplate;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setNewProjectTemplate(t.id)}
                          aria-pressed={checked}
                          className={`w-full flex items-start gap-3 text-left p-3 border transition-all ${
                            checked
                              ? 'bg-blue-50 border-blue-500 shadow-sm'
                              : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <span
                            className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                              checked
                                ? 'bg-blue-600 border-blue-600'
                                : 'bg-white border-slate-300'
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-[11px] font-black uppercase tracking-tight text-slate-800">
                                {t.name}
                              </p>
                              <span className="text-[10px] font-black tabular-nums text-slate-500">
                                · {enabledCount}/{TOTAL_ITEM_COUNT}
                              </span>
                            </div>
                            <p className="text-[10px] font-medium text-slate-500 mt-0.5 leading-snug">
                              {t.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {createError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border-l-4 border-red-500 text-red-600 text-[11px] font-black uppercase tracking-widest leading-snug">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowAddProject(false);
                    setCreateError(null);
                    setNewProjectTemplate(DEFAULT_TEMPLATE_ID);
                  }}
                  disabled={creating}
                  className="flex-1 px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddProject}
                  disabled={creating || !newProjectName.trim()}
                  className="flex-1 bg-blue-600 text-white px-6 py-3.5 text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {creating && <Loader2 size={12} className="animate-spin" />}
                  Create Project
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Permanent delete confirmation modal */}
      <AnimatePresence>
        {deletingProject && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md p-8 rounded-sm shadow-2xl space-y-5"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-red-50 rounded-full flex items-center justify-center">
                  <Trash2 size={18} className="text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900 mb-1">
                    Permanently Delete Project
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                    This will permanently remove the project and all of its data
                    (metrics, notes, deliverables, score history, attachments)
                    from the database. This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 border-l-4 border-red-500 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Project To Delete
                </p>
                <p className="text-sm font-black text-slate-900 truncate">
                  {deletingProject.name}
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Type the project name to confirm
                </label>
                <input
                  autoFocus
                  value={deleteConfirmText}
                  onChange={(e) => {
                    setDeleteConfirmText(e.target.value);
                    if (deleteError) setDeleteError(null);
                  }}
                  placeholder={deletingProject.name}
                  className="w-full border border-slate-200 p-3.5 font-bold text-sm outline-none focus:border-red-500 bg-slate-50"
                />
              </div>

              {deleteError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border-l-4 border-red-500 text-red-600 text-[11px] font-black uppercase tracking-widest leading-snug">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setDeletingProject(null);
                    setDeleteConfirmText('');
                    setDeleteError(null);
                  }}
                  disabled={deleting}
                  className="flex-1 px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteProject}
                  disabled={
                    deleting ||
                    deleteConfirmText.trim() !== deletingProject.name.trim()
                  }
                  className="flex-1 bg-red-600 text-white px-6 py-3.5 text-[10px] font-black uppercase tracking-widest hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting && <Loader2 size={12} className="animate-spin" />}
                  <Trash2 size={12} /> Delete Forever
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => setAuthModalOpen(false)}
      />
    </div>
  );
};

// ---- Sub-components -------------------------------------------------------

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}> = ({ active, onClick, icon, label, badge }) => (
  <button
    onClick={onClick}
    className={`px-6 py-4 text-[10px] font-black uppercase tracking-widest transition-all relative flex items-center gap-2 whitespace-nowrap ${
      active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
    }`}
  >
    {icon}
    {label}
    {badge != null && badge > 0 && (
      <span
        className={`ml-1 px-2 py-0.5 rounded-full text-[8px] ${
          active ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {badge}
      </span>
    )}
    {active && <div className="absolute bottom-0 left-0 w-full h-1 bg-blue-600"></div>}
  </button>
);

const ProjectList: React.FC<{
  projects: ProjectRecord[];
  emptyTitle: string;
  emptySubtitle: string;
  emptyCta?: React.ReactNode;
  onSelect: (p: ProjectRecord) => void;
  onDelete?: (p: ProjectRecord) => void;
  archiveMode?: boolean;
}> = ({
  projects,
  emptyTitle,
  emptySubtitle,
  emptyCta,
  onSelect,
  onDelete,
  archiveMode
}) => {
  if (projects.length === 0) {
    return (
      <div className="bg-white border-2 border-dashed border-slate-200 p-20 text-center rounded-sm">
        <div className="inline-flex items-center justify-center p-6 bg-slate-50 rounded-full mb-6">
          {archiveMode ? (
            <Archive size={40} className="text-slate-300" />
          ) : (
            <TrendingUp size={40} className="text-slate-300" />
          )}
        </div>
        <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter mb-3">
          {emptyTitle}
        </h3>
        <p className="text-slate-500 text-sm font-medium max-w-md mx-auto mb-8">
          {emptySubtitle}
        </p>
        {emptyCta}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {projects.map((p) => (
        <ProjectCard
          key={p.id}
          project={p}
          onSelect={onSelect}
          onDelete={onDelete}
          archiveMode={archiveMode}
        />
      ))}
    </div>
  );
};

const ProjectCard: React.FC<{
  project: ProjectRecord;
  onSelect: (p: ProjectRecord) => void;
  onDelete?: (p: ProjectRecord) => void;
  archiveMode?: boolean;
}> = ({ project, onSelect, onDelete, archiveMode }) => {
  // Compute the score from persisted metrics if available, otherwise use the
  // cached `lastScore`. Either way the user gets a real, meaningful number.
  // IMPORTANT: disabledItemIds must be passed through — scoreForProject
  // excludes all-disabled groups from the rollup, and without it we'd score
  // against items the user has explicitly taken out of scope.
  const score = useMemo(() => {
    if (project.metrics) {
      // Match ProjectDeepDive precisely:
      //   1. effectiveMetrics() rewrites BAR-kind items to their deliverable %
      //      (mirrors the metrics-rewrite useEffect in ProjectDeepDive — bar
      //       items don't persist their derived value until the user saves).
      //   2. deriveDeliverableScores() returns the per-item % for VALUE-kind
      //      items, which scoreForProject blends 50/50 with the numeric value.
      // Without (1) bar items used stale persisted values; without (2) value
      // items skipped the deliverable blend entirely.
      const liveMetrics = effectiveMetrics(project.metrics, project.deliverables);
      const ds = deriveDeliverableScores(project.deliverables);
      return scoreForProject(liveMetrics, project.disabledItemIds, ds);
    }
    if (project.lastScore != null) return Math.round(project.lastScore);
    return 0;
  }, [project]);
  const band = scoreBand(score);

  const created = project.createdAt?.toDate?.()?.toLocaleDateString() || '—';
  const closed = project.closedAt?.toDate?.()?.toLocaleDateString();

  // Card is a div (not <button>) because archived cards host a nested
  // delete button — nesting interactive elements inside a <button> is invalid
  // HTML and breaks keyboard semantics. role/tabIndex/keyboard handlers
  // preserve the click-to-open behavior for assistive tech.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(project)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(project);
        }
      }}
      className="group bg-white border border-slate-200 hover:border-blue-400 hover:shadow-xl transition-all rounded-sm p-6 text-left flex flex-col gap-5 relative overflow-hidden cursor-pointer focus:outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-200"
    >
      {/* Status pill */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mb-1">
            {project.productType || 'Hardware'}
          </p>
          <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 leading-tight truncate">
            {project.name}
          </h3>
        </div>
        {archiveMode ? (
          <span
            className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 flex items-center gap-1 ${
              project.closeReason === 'cancelled'
                ? 'bg-red-50 text-red-600'
                : 'bg-emerald-50 text-emerald-600'
            }`}
          >
            {project.closeReason === 'cancelled' ? (
              <>
                <XCircle size={10} /> Cancelled
              </>
            ) : (
              <>
                <CheckCircle2 size={10} /> Completed
              </>
            )}
          </span>
        ) : (
          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 bg-blue-50 text-blue-600 flex items-center gap-1">
            <ShieldCheck size={10} /> Active
          </span>
        )}
      </div>

      {/* Score */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            Readiness
          </span>
          <span className={`text-2xl font-black tracking-tight ${band.text}`}>
            {score}%
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, ${band.fill}, ${band.stroke})` }}
          />
        </div>
        <p
          className={`mt-2 text-[9px] font-black uppercase tracking-[0.2em] ${band.text}`}
        >
          {band.label}
        </p>
      </div>

      {/* Footer meta */}
      <div className="mt-auto flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400 pt-4 border-t border-slate-100">
        <span className="flex items-center gap-1.5">
          <Calendar size={11} />
          {archiveMode && closed ? `Closed ${closed}` : `Created ${created}`}
        </span>
        <span className="flex items-center gap-3">
          {archiveMode && onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(project);
              }}
              title="Permanently delete project"
              aria-label={`Permanently delete ${project.name}`}
              className="flex items-center gap-1 text-slate-400 hover:text-red-600 transition-colors focus:outline-none focus-visible:text-red-600"
            >
              <Trash2 size={11} /> Delete
            </button>
          )}
          <span className="flex items-center gap-1 text-slate-500 group-hover:text-blue-600 transition-colors">
            Open <ChevronRight size={12} />
          </span>
        </span>
      </div>
    </div>
  );
};

export default Dashboard;
