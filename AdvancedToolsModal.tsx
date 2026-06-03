import React, { useState } from 'react';
import { X, Cpu, ArrowLeft, Receipt, FileSearch, Tag, ShieldCheck } from 'lucide-react';
import BOMAnalyzerTool from './BOMAnalyzerTool.tsx';
import QuoteCompareTool from './QuoteCompareTool.tsx';
import DocGuardTool from './DocGuardTool.tsx';
import EntityTagsTool from './EntityTagsTool.tsx';
import CompanyGuidelinesTool from './CompanyGuidelinesTool.tsx';

interface AdvancedToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AdvancedToolsModal: React.FC<AdvancedToolsModalProps> = ({ isOpen, onClose }) => {
  console.log('🏁 AdvancedToolsModal function called with isOpen:', isOpen);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '32px', width: '90%', maxWidth: '600px', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: '2px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {selectedTool && (
              <button
                type="button"
                onClick={() => setSelectedTool(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: '#0f172a' }}
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 style={{ fontSize: '20px', fontWeight: 900, textTransform: 'uppercase', margin: 0, color: '#0f172a' }}>
              {selectedTool === 'bom-analyzer'
                ? 'Alt BOM'
                : selectedTool === 'quote-compare'
                  ? 'Quote Compare'
                  : selectedTool === 'doc-guard'
                    ? 'Doc Guard'
                    : selectedTool === 'entity-tags'
                      ? 'Entity Tags'
                      : selectedTool === 'company-guidelines'
                        ? 'SOP Radar'
                        : 'Tools'}
            </h2>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '28px', color: '#64748b', padding: 0, lineHeight: 1 }}>
            ×
          </button>
        </div>

        {!selectedTool ? (
          <div>
            <div
              onClick={() => setSelectedTool('bom-analyzer')}
              style={{ padding: '24px', border: '2px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', marginBottom: '12px', display: 'flex', gap: '16px', alignItems: 'center', transition: 'all 0.2s', backgroundColor: '#fafafa' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#0f172a';
                e.currentTarget.style.backgroundColor = '#f0f0f0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e2e8f0';
                e.currentTarget.style.backgroundColor = '#fafafa';
              }}
            >
              <Cpu size={48} color="#64748b" />
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 900, textTransform: 'uppercase', margin: 0, marginBottom: '4px', color: '#0f172a' }}>Alt BOM</h3>
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Find a qualified second-source alternate for every line on your BOM</p>
              </div>
            </div>

            <div
              onClick={() => setSelectedTool('quote-compare')}
              style={{ padding: '24px', border: '2px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', marginBottom: '12px', display: 'flex', gap: '16px', alignItems: 'center', transition: 'all 0.2s', backgroundColor: '#fafafa' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#0f172a';
                e.currentTarget.style.backgroundColor = '#f0f0f0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e2e8f0';
                e.currentTarget.style.backgroundColor = '#fafafa';
              }}
            >
              <Receipt size={48} color="#64748b" />
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 900, textTransform: 'uppercase', margin: 0, marginBottom: '4px', color: '#0f172a' }}>Quote Compare</h3>
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Benchmark a supplier quote against current market pricing</p>
              </div>
            </div>

            <div
              onClick={() => setSelectedTool('doc-guard')}
              style={{ padding: '24px', border: '2px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', marginBottom: '12px', display: 'flex', gap: '16px', alignItems: 'center', transition: 'all 0.2s', backgroundColor: '#fafafa' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#0f172a';
                e.currentTarget.style.backgroundColor = '#f0f0f0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e2e8f0';
                e.currentTarget.style.backgroundColor = '#fafafa';
              }}
            >
              <FileSearch size={48} color="#64748b" />
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 900, textTransform: 'uppercase', margin: 0, marginBottom: '4px', color: '#0f172a' }}>Doc Guard</h3>
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Audit a manufacturing PDF for grammar, GMP, assembly logic, and image clarity</p>
              </div>
            </div>

            <div
              onClick={() => setSelectedTool('entity-tags')}
              style={{ padding: '24px', border: '2px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', marginBottom: '12px', display: 'flex', gap: '16px', alignItems: 'center', transition: 'all 0.2s', backgroundColor: '#fafafa' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#0f172a';
                e.currentTarget.style.backgroundColor = '#f0f0f0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e2e8f0';
                e.currentTarget.style.backgroundColor = '#fafafa';
              }}
            >
              <Tag size={48} color="#64748b" />
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 900, textTransform: 'uppercase', margin: 0, marginBottom: '4px', color: '#0f172a' }}>Entity Tags</h3>
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Normalize supplier and component names across projects for smarter Org Insights</p>
              </div>
            </div>

            <div
              onClick={() => setSelectedTool('company-guidelines')}
              style={{ padding: '24px', border: '2px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', marginBottom: '12px', display: 'flex', gap: '16px', alignItems: 'center', transition: 'all 0.2s', backgroundColor: '#fafafa' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#0f172a';
                e.currentTarget.style.backgroundColor = '#f0f0f0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e2e8f0';
                e.currentTarget.style.backgroundColor = '#fafafa';
              }}
            >
              <ShieldCheck size={48} color="#64748b" />
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 900, textTransform: 'uppercase', margin: 0, marginBottom: '4px', color: '#0f172a' }}>SOP Radar</h3>
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Upload SOPs and procedures — AI scans every project for compliance drift automatically</p>
              </div>
            </div>
          </div>
        ) : selectedTool === 'bom-analyzer' ? (
          <BOMAnalyzerTool />
        ) : selectedTool === 'quote-compare' ? (
          <QuoteCompareTool />
        ) : selectedTool === 'doc-guard' ? (
          <DocGuardTool />
        ) : selectedTool === 'entity-tags' ? (
          <EntityTagsTool />
        ) : selectedTool === 'company-guidelines' ? (
          <CompanyGuidelinesTool />
        ) : null}
      </div>
    </div>
  );
};

export default AdvancedToolsModal;
