// ---------------------------------------------------------------------------
// EntityTagsTool.tsx
//
// Self-contained alias-dictionary editor. Rendered inline inside
// AdvancedToolsModal — no overlay wrapper, no external props.
// Imports db + auth from firebase.ts directly (same pattern as
// BOMAnalyzerTool / DocGuardTool).
// ---------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Save, Loader2, X, Tag } from 'lucide-react';
import { auth, db } from './firebase.ts';
import { loadEntityAliases, saveEntityAliases, EntityAliasMap } from './orgAliasesClient.ts';

const EntityTagsTool: React.FC = () => {
  const [aliases, setAliases]           = useState<EntityAliasMap>({});
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [saveOk, setSaveOk]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [newCanonical, setNewCanonical] = useState('');
  const [expandedKey, setExpandedKey]   = useState<string | null>(null);
  const [addAliasInput, setAddAliasInput] = useState<Record<string, string>>({});

  const userId = auth.currentUser?.uid ?? null;

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    loadEntityAliases(db, userId).then((a) => {
      setAliases(a);
      setLoading(false);
    });
  }, [userId]);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      await saveEntityAliases(db, userId, aliases);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch (err: any) {
      setError(err?.message ?? 'Save failed — please retry.');
    } finally {
      setSaving(false);
    }
  };

  const addEntity = () => {
    const canonical = newCanonical.trim();
    if (!canonical) return;
    if (aliases[canonical]) { setError(`"${canonical}" already exists.`); return; }
    setAliases({ ...aliases, [canonical]: [] });
    setNewCanonical('');
    setExpandedKey(canonical);
    setError(null);
  };

  const removeEntity = (canonical: string) => {
    const { [canonical]: _, ...rest } = aliases;
    setAliases(rest);
    if (expandedKey === canonical) setExpandedKey(null);
  };

  const addAlias = (canonical: string) => {
    const alias = (addAliasInput[canonical] ?? '').trim();
    if (!alias) return;
    const current = aliases[canonical] ?? [];
    if (current.includes(alias)) return;
    setAliases({ ...aliases, [canonical]: [...current, alias] });
    setAddAliasInput({ ...addAliasInput, [canonical]: '' });
  };

  const removeAlias = (canonical: string, alias: string) => {
    setAliases({ ...aliases, [canonical]: (aliases[canonical] ?? []).filter((a) => a !== alias) });
  };

  const canonicalKeys = Object.keys(aliases).sort((a, b) => a.localeCompare(b));

  if (!userId) {
    return <p style={{ color: '#64748b', fontSize: '13px' }}>Sign in to manage entity tags.</p>;
  }

  return (
    <div>
      {/* Description */}
      <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '20px', lineHeight: 1.6 }}>
        Map alternate names to a canonical entity so the AI connects the same supplier,
        component, or partner across projects — even when named differently.
        E.g. canonical <strong style={{ color: '#0f172a' }}>ACME Corp</strong> with
        aliases <strong style={{ color: '#0f172a' }}>Acme</strong>, <strong style={{ color: '#0f172a' }}>ACME Electronics</strong>.
      </p>

      {/* Add entity row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          type="text"
          value={newCanonical}
          onChange={(e) => setNewCanonical(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addEntity(); }}
          placeholder="Canonical name (e.g. ACME Corp)"
          maxLength={100}
          style={{
            flex: 1,
            border: '2px solid #e2e8f0',
            borderRadius: '6px',
            padding: '10px 12px',
            fontSize: '12px',
            outline: 'none',
            color: '#0f172a'
          }}
        />
        <button
          onClick={addEntity}
          disabled={!newCanonical.trim()}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            backgroundColor: newCanonical.trim() ? '#0f172a' : '#e2e8f0',
            color: newCanonical.trim() ? '#fff' : '#94a3b8',
            border: 'none', borderRadius: '6px',
            padding: '10px 14px', fontSize: '11px',
            fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em',
            cursor: newCanonical.trim() ? 'pointer' : 'not-allowed'
          }}
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {/* Entity list */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', fontSize: '12px', padding: '24px 0' }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
        </div>
      ) : canonicalKeys.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: '12px' }}>
          <Tag size={28} style={{ marginBottom: '8px', opacity: 0.4 }} />
          <p style={{ margin: 0 }}>No entities defined yet — add one above.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {canonicalKeys.map((canonical) => {
            const aliasList = aliases[canonical] ?? [];
            const isExpanded = expandedKey === canonical;
            return (
              <div key={canonical} style={{ border: '2px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                {/* Canonical header row */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '12px 14px', backgroundColor: '#f8fafc',
                    cursor: 'pointer'
                  }}
                >
                  <div
                    onClick={() => setExpandedKey(isExpanded ? null : canonical)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}
                  >
                    {isExpanded
                      ? <ChevronDown size={12} color="#94a3b8" />
                      : <ChevronRight size={12} color="#94a3b8" />
                    }
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {canonical}
                    </span>
                    <span style={{ fontSize: '10px', color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {aliasList.length === 0 ? 'no aliases' : `${aliasList.length} alias${aliasList.length !== 1 ? 'es' : ''}`}
                    </span>
                  </div>
                  <button
                    onClick={() => removeEntity(canonical)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#cbd5e1', display: 'flex' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#cbd5e1')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* Expanded alias panel */}
                {isExpanded && (
                  <div style={{ padding: '12px 14px', borderTop: '1px solid #e2e8f0', backgroundColor: '#fff' }}>
                    {/* Alias chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                      {aliasList.length === 0 && (
                        <span style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>No aliases yet</span>
                      )}
                      {aliasList.map((alias) => (
                        <span
                          key={alias}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
                            color: '#3b82f6', fontSize: '11px',
                            padding: '2px 8px', borderRadius: '9999px'
                          }}
                        >
                          {alias}
                          <button
                            onClick={() => removeAlias(canonical, alias)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'inherit' }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '')}
                          >
                            <X size={9} />
                          </button>
                        </span>
                      ))}
                    </div>
                    {/* Add alias input */}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        type="text"
                        value={addAliasInput[canonical] ?? ''}
                        onChange={(e) => setAddAliasInput({ ...addAliasInput, [canonical]: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') addAlias(canonical); }}
                        placeholder="Add alias…"
                        maxLength={100}
                        style={{
                          flex: 1, border: '1px solid #e2e8f0', borderRadius: '6px',
                          padding: '6px 10px', fontSize: '11px', outline: 'none', color: '#0f172a'
                        }}
                      />
                      <button
                        onClick={() => addAlias(canonical)}
                        disabled={!(addAliasInput[canonical] ?? '').trim()}
                        style={{
                          border: '1px solid #bfdbfe', borderRadius: '6px',
                          backgroundColor: 'transparent', color: '#3b82f6',
                          padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center'
                        }}
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: status + save */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '8px' }}>
        <div style={{ flex: 1, fontSize: '11px' }}>
          {error  && <span style={{ color: '#ef4444' }}>{error}</span>}
          {saveOk && <span style={{ color: '#16a34a' }}>Saved — aliases apply on next Org Insights run.</span>}
        </div>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            backgroundColor: saving || loading ? '#e2e8f0' : '#0f172a',
            color: saving || loading ? '#94a3b8' : '#fff',
            border: 'none', borderRadius: '6px',
            padding: '10px 18px', fontSize: '11px',
            fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em',
            cursor: saving || loading ? 'not-allowed' : 'pointer'
          }}
        >
          {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
          Save Aliases
        </button>
      </div>
    </div>
  );
};

export default EntityTagsTool;
