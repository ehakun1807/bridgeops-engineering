// ---------------------------------------------------------------------------
// ProjectAIChat — floating AI Advisor chat panel.
// Renders a FAB (bottom-right of any project page) that opens a slide-in
// panel. Sends messages to /api/ai-chat with live project context.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { X, Send, BrainCircuit, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth } from './firebase.ts';

export interface ProjectChatContext {
  projectId: string;
  projectName: string;
  productType?: string;
  currentGate?: string;
  rampScore?: number;
  standards?: string[];
  pfmeaHighRisks?: Array<{ description: string; rpn: number }>;
  openDecisions?: string[];
  bomFlags?: string[];
  supplyChainScore?: number;
  qualityScore?: number;
  manufacturingScore?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  grounded?: boolean;
}

const STARTERS = [
  'Am I ready for this gate?',
  'What are my top 3 risks?',
  "What's blocking my RAMP score?",
  'Summarize my open decisions.',
];

export const ProjectAIChat: React.FC<{ context: ProjectChatContext }> = ({ context }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in');
      const idToken = await user.getIdToken(false);

      // Build history from current messages (exclude the one we just added)
      const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          message: trimmed,
          history,
          projectContext: {
            projectName: context.projectName,
            productType: context.productType,
            currentGate: context.currentGate,
            rampScore: context.rampScore,
            standards: context.standards,
            pfmeaHighRisks: context.pfmeaHighRisks,
            openDecisions: context.openDecisions,
            bomFlags: context.bomFlags,
            supplyChainScore: context.supplyChainScore,
            qualityScore: context.qualityScore,
            manufacturingScore: context.manufacturingScore,
          }
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply,
        grounded: data.grounded,
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: 'assistant', content: `Sorry, something went wrong: ${err.message}` }
      ]);
    } finally {
      setLoading(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const contextTags = [
    context.currentGate ? `Gate: ${context.currentGate}` : null,
    context.rampScore !== undefined ? `RAMP ${Math.round(context.rampScore)}%` : null,
    context.pfmeaHighRisks && context.pfmeaHighRisks.length > 0 ? `${context.pfmeaHighRisks.length} high-RPN` : null,
  ].filter(Boolean) as string[];

  return (
    <>
      {/* FAB */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/40 flex items-center justify-center hover:bg-blue-500 transition-colors"
            title="AI Advisor"
          >
            <BrainCircuit size={20} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[380px] flex flex-col bg-slate-900 border-l border-slate-700/60 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/60 flex-shrink-0">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-700 to-blue-500 flex items-center justify-center flex-shrink-0">
                <BrainCircuit size={15} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-100 leading-tight">AI Advisor</div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  {context.projectName}
                  {context.currentGate && <span className="text-slate-600">·</span>}
                  {context.currentGate && <span>{context.currentGate}</span>}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-md border border-slate-700 text-slate-500 hover:text-slate-300 flex items-center justify-center text-xs transition-colors"
              >
                <X size={13} />
              </button>
            </div>

            {/* Context strip */}
            {contextTags.length > 0 && (
              <div className="flex gap-2 px-4 py-2 border-b border-slate-700/40 bg-blue-950/20 flex-shrink-0 flex-wrap">
                {contextTags.map((tag, i) => (
                  <span
                    key={i}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                      tag.includes('high-RPN')
                        ? 'bg-amber-950/40 border-amber-700/30 text-amber-400'
                        : 'bg-blue-950/40 border-blue-700/30 text-blue-400'
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700">
              {messages.length === 0 && (
                <div className="text-center mt-8">
                  <div className="w-10 h-10 rounded-xl bg-blue-950/50 border border-blue-800/30 flex items-center justify-center mx-auto mb-3">
                    <BrainCircuit size={18} className="text-blue-400" />
                  </div>
                  <p className="text-xs text-slate-500 max-w-[220px] mx-auto leading-relaxed">
                    Ask anything about this project. I have full context of your program data.
                  </p>
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <span className={`text-[9.5px] font-semibold uppercase tracking-wider ${msg.role === 'user' ? 'text-blue-500/60 pr-1' : 'text-slate-500 pl-1'}`}>
                    {msg.role === 'user' ? 'You' : 'AI Advisor'}
                  </span>
                  <div
                    className={`max-w-[88%] px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-900/60 border border-blue-700/30 text-blue-50 rounded-xl rounded-tr-sm'
                        : 'bg-slate-800 border border-slate-700/50 text-slate-200 rounded-xl rounded-tl-sm'
                    }`}
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {msg.content}
                  </div>
                  {msg.role === 'assistant' && msg.grounded && (
                    <span className="text-[9px] font-semibold text-emerald-500/70 pl-1 tracking-wide">
                      ✓ Validated against current industry data
                    </span>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex flex-col items-start gap-1">
                  <span className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500 pl-1">AI Advisor</span>
                  <div className="bg-slate-800 border border-slate-700/50 rounded-xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:0ms]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:150ms]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:300ms]"></span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Footer */}
            <div className="px-4 pb-4 pt-2 border-t border-slate-700/40 flex-shrink-0">
              {/* Starter chips — only when no messages */}
              {messages.length === 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {STARTERS.map(s => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="bg-slate-800 border border-slate-700 rounded-full px-3 py-1 text-[11px] text-slate-400 hover:border-blue-600/40 hover:text-blue-400 transition-colors whitespace-nowrap"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Ask anything about this project…"
                  disabled={loading}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-[13px] text-slate-100 placeholder-slate-600 outline-none focus:border-blue-600/50 resize-none min-h-[40px] max-h-[120px] leading-tight disabled:opacity-50 font-[inherit]"
                />
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || loading}
                  className="w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-colors"
                >
                  {loading ? <Loader2 size={14} className="text-white animate-spin" /> : <Send size={14} className="text-white" />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
