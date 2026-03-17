
import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from 'framer-motion';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronRight, 
  ClipboardCheck, 
  Cpu, 
  Download,
  Factory, 
  FileText, 
  Gauge, 
  HelpCircle,
  Info, 
  Layers, 
  Loader2, 
  Lock,
  Mail,
  MessageCircle,
  ShieldAlert, 
  TrendingUp,
  Zap
} from 'lucide-react';

const Tooltip: React.FC<{ text: string }> = ({ text }) => {
  const [show, setShow] = useState(false);
  
  return (
    <div className="relative inline-block ml-1.5 align-middle">
      <div 
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="cursor-help text-slate-400 hover:text-blue-600 transition-colors"
      >
        <HelpCircle size={12} />
      </div>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-900 text-white text-[10px] font-medium rounded shadow-xl pointer-events-none text-center leading-relaxed"
          >
            {text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900"></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AdminLogin: React.FC<{ onLogin: () => void; onClose: () => void }> = ({ onLogin, onClose }) => {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleNext = () => {
    if (step === 1) {
      if (username === 'BridgeOps11') {
        setStep(2);
        setError('');
      } else {
        setError('Invalid username');
      }
    } else {
      if (password === 'Amit2017!') {
        onLogin();
      } else {
        setError('Invalid password');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-md p-8 rounded-sm border border-slate-200 shadow-2xl"
      >
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 flex items-center">
            <Lock className="mr-2 text-blue-600" size={18} />
            Admin Access
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <Zap size={18} />
          </button>
        </div>

        <div className="space-y-6">
          {step === 1 ? (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Username</label>
              <input 
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                autoFocus
                className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Password</label>
              <input 
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                autoFocus
                className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          )}

          {error && <p className="text-red-500 text-[10px] font-bold uppercase tracking-widest">{error}</p>}

          <button 
            onClick={handleNext}
            className="w-full bg-slate-900 hover:bg-blue-600 text-white py-4 font-black uppercase tracking-[0.2em] text-xs transition-all flex items-center justify-center group"
          >
            {step === 1 ? 'Next Step' : 'Unlock Admin'}
            <ChevronRight size={16} className="ml-2" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};

interface KPI {
  category: string;
  metric: string;
  description: string;
  target: string;
}

interface AssessmentResult {
  score: number;
  riskLevel: string;
  risks: string[];
  recommendations: string[];
  analysis: string;
  kpis: KPI[];
}

const PRODUCT_SEGMENTS = [
  "Medical Device",
  "Agrotech",
  "Military / Defense",
  "Automotive",
  "Consumer Electronics",
  "Industrial Automation / Robotics",
  "Aerospace",
  "Telecommunications",
  "Energy / CleanTech",
  "IoT Devices",
  "Wearables",
  "Other Hardware"
];

const SEGMENT_STANDARDS: Record<string, string[]> = {
  "Medical Device": ["ISO 13485 (QMS)", "FDA 21 CFR 820", "ISO 14971 (Risk)", "IEC 60601 (Safety)", "ISO 27001 (Cyber)", "Not Sure/Not Required"],
  "Agrotech": ["ISO 11783 (ISOBUS)", "CE Marking", "IP67/68 Rating", "ISO 27001 (Cyber)", "Not Sure/Not Required"],
  "Military / Defense": ["MIL-STD-810", "ITAR Compliance", "AS9100", "NIST 800-171 (Cyber)", "Not Sure/Not Required"],
  "Automotive": ["IATF 16949", "ISO 26262 (Safety)", "APQP/PPAP", "ISO 21434 (Cyber)", "Not Sure/Not Required"],
  "Consumer Electronics": ["CE / FCC", "RoHS / WEEE", "UL Listing", "ISO 27001 (Cyber)", "Not Sure/Not Required"],
  "Industrial Automation / Robotics": ["ISO 10218 (Safety)", "Machinery Directive", "IEC 61131", "ISO 27001 (Cyber)", "Not Sure/Not Required"],
  "Aerospace": ["AS9100", "DO-178C / DO-254", "FAA Certification", "ISO 27001 (Cyber)", "Not Sure/Not Required"],
  "Telecommunications": ["NEBS Compliance", "ETSI Standards", "FCC Part 15", "ISO 27001 (Cyber)", "Not Sure/Not Required"],
  "Energy / CleanTech": ["ISO 50001", "UL 1741", "IEC 61730", "ISO 27001 (Cyber)", "Not Sure/Not Required"],
  "IoT Devices": ["ISO 27001 (Cyber)", "GDPR Compliance", "SAR Testing", "RED Directive", "Not Sure/Not Required"],
  "Wearables": ["ISO 27001 (Cyber)", "Biocompatibility", "SAR Testing", "CE / FCC", "Not Sure/Not Required"],
  "Other Hardware": ["ISO 9001", "CE / FCC", "ISO 27001 (Cyber)", "Not Sure/Not Required"]
};

const IS_COMING_SOON = false;

const RampScoreTool: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [isStandardsOpen, setIsStandardsOpen] = useState(false);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === 'true') {
      setIsAdmin(true);
    }
  }, []);

  const downloadPDF = () => {
    const element = document.getElementById('report-content');
    if (!element) return;

    const opt = {
      margin: 10,
      filename: `BridgeOps_Ramp_Readiness_${formData.companyName || 'Report'}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4' as const, orientation: 'portrait' as const },
      pagebreak: { mode: ['css', 'legacy'] }
    };

    // Temporarily add a class to the element to style it for the PDF generator
    element.classList.add('pdf-export-mode');
    
    html2pdf().set(opt).from(element).save().then(() => {
      element.classList.remove('pdf-export-mode');
    });
  };

  const [formData, setFormData] = useState({
    companyName: '',
    clientEmail: '',
    complexity: 'medium',
    supplyChain: 'mixed',
    dmrCompleteness: 50,
    testCoverage: 40,
    ecoGovernance: 'loose',
    targetVolume: '1000',
    numSuppliers: '10',
    manufacturingMaturity: 50,
    criticalComponentsSecondSource: 50,
    productDesignMaturity: 50,
    productType: PRODUCT_SEGMENTS[0],
    selectedStandards: [] as string[]
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ 
      ...prev, 
      [name]: value,
      // Reset standards if product type changes
      selectedStandards: name === 'productType' ? [] : prev.selectedStandards
    }));
  };

  const toggleStandard = (standard: string) => {
    setFormData(prev => {
      const isNotSure = standard === "Not Sure/Not Required";
      let nextStandards = [...prev.selectedStandards];
      
      if (nextStandards.includes(standard)) {
        nextStandards = nextStandards.filter(s => s !== standard);
      } else {
        if (isNotSure) {
          // If selecting "Not Sure", clear all others
          nextStandards = [standard];
        } else {
          // If selecting something else, remove "Not Sure" if it was there
          nextStandards = nextStandards.filter(s => s !== "Not Sure/Not Required");
          nextStandards.push(standard);
        }
      }
      
      return {
        ...prev,
        selectedStandards: nextStandards
      };
    });
  };

  const runAssessment = async () => {
    setLoading(true);
    try {
      // Robust API key selection for different environments
      const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
      
      if (!apiKey) {
        throw new Error("API Key not found. Please ensure GEMINI_API_KEY is set.");
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const maxRetries = 3;
      let attempt = 0;
      let lastError: any = null;

      while (attempt < maxRetries) {
        try {
          const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: `Assess the manufacturing ramp-up readiness for the following hardware project:
            Product Type: ${formData.productType}
            Complexity: ${formData.complexity}
            Number of Suppliers: ${formData.numSuppliers}
            Critical Components Second Source: ${formData.criticalComponentsSecondSource}% (Percentage of critical components with a qualified second source)
            Product Design Maturity: ${formData.productDesignMaturity}% (Stability of design, completion of DVT/PVT phases, and BOM readiness)
            Manufacturing Maturity: ${formData.manufacturingMaturity}% (The overall readiness of the production processes and tools)
            Supply Chain Maturity: ${formData.supplyChain}
            DMR (Device Master Record) Completeness: ${formData.dmrCompleteness}%
            Product Testability Coverage: ${formData.testCoverage}%
            ECO (Engineering Change Order) Governance: ${formData.ecoGovernance}
            Target Production Volume: ${formData.targetVolume} units/month
            Target Regulatory Standards: ${formData.selectedStandards.join(', ') || 'None specified'}
            
            Note: If "Not Sure/Not Required" is specified for standards, consider this a significant risk factor if the Product Type typically requires strict compliance (e.g. Medical, Aerospace, Automotive).
            
            Please provide:
            1. A Readiness Score (0-100).
            2. A Risk Level (e.g., LOW, MEDIUM, MEDIUM-HIGH, HIGH).
            3. Risk Drivers: Specific risks based on the inputs provided.
            4. Recommended Mitigations: Actionable steps to address the risk drivers.
            
            Also provide specific targets and descriptions for the following 10 critical KPIs based on the project parameters:
            1. Quality: First Pass Yield (FPY) - Percentage of units meeting all specs on first attempt without rework.
            2. Volume: Production Schedule Attainment - Ability to hit planned production targets (Actual/Planned).
            3. Speed: Manufacturing Cycle Time - Total time to transform raw materials into finished product.
            4. Efficiency: Overall Equipment Effectiveness (OEE) - Availability x Performance x Quality.
            5. Waste: Scrap Rate - Percentage of defective materials/units that cannot be salvaged.
            6. NPI Maturity: Time-to-Volume - Duration from ramp-up start until full steady-state capacity.
            7. Scaling: Capacity Utilization - Ratio of actual output to potential output of the facility.
            8. Workforce: Training Hours per Employee - Investment in workforce readiness and safety.
            9. Flexibility: Changeover Time - Time required to switch between product variants or batches.
            10. Reliability: Customer Return Rate (Early Life Failure) - Percentage of products returned shortly after launch.`,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  score: { type: Type.NUMBER, description: "Readiness score from 0 to 100" },
                  riskLevel: { type: Type.STRING, description: "Risk level (e.g. MEDIUM-HIGH)" },
                  risks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of major risk drivers detected" },
                  recommendations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of recommended mitigations" },
                  analysis: { type: Type.STRING, description: "Brief executive summary of the assessment" },
                  kpis: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        category: { type: Type.STRING },
                        metric: { type: Type.STRING },
                        description: { type: Type.STRING },
                        target: { type: Type.STRING, description: "Recommended target value for this metric" }
                      },
                      required: ["category", "metric", "description", "target"]
                    }
                  }
                },
                required: ["score", "riskLevel", "risks", "recommendations", "analysis", "kpis"]
              }
            }
          });

          if (!response.text) {
            throw new Error("Model returned an empty response.");
          }

          const data = JSON.parse(response.text);
          setResult(data);
          return; // Success!
        } catch (error: any) {
          lastError = error;
          // If it's a 503 (Service Unavailable) or 429 (Too Many Requests), retry
          if (error.message?.includes("503") || error.message?.includes("429") || error.status === 503 || error.status === 429) {
            attempt++;
            if (attempt < maxRetries) {
              const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
              console.warn(`Gemini API busy (Attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`, error);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
          throw error; // Re-throw if not a retryable error or max retries reached
        }
      }
    } catch (error: any) {
      console.error("Assessment failed:", error);
      const errorMessage = error.message || "Unknown error";
      alert(`The AI service is currently experiencing high traffic (Error 503). 
      
We've attempted to retry automatically, but the service remains busy. Please try again in 1-2 minutes, or check if your Gemini API key has sufficient quota in the Google AI Studio dashboard.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-12 text-left">
        <div className="flex items-center space-x-2 mb-4">
          <div className="w-10 h-[1px] bg-blue-600"></div>
          <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">AI-Powered Assessment</span>
        </div>
        <h1 className="text-4xl md:text-6xl font-black text-slate-900 tracking-tighter uppercase leading-none">
          BridgeOps Ramp-Up <br/><span className="text-blue-600 italic">Readiness Score.</span>
        </h1>
        <p className="text-slate-500 mt-6 text-lg font-medium max-w-2xl leading-relaxed">
          Evaluate your transition from prototype to mass production. Our AI engine analyzes your operational maturity and identifies critical bottlenecks before they impact your launch.
        </p>
      </div>

      {IS_COMING_SOON ? (
        <div className="bg-slate-900 p-12 text-center border border-white/10 relative overflow-hidden group">
          <div className="absolute inset-0 blueprint-grid-dark opacity-20"></div>
          <div className="relative z-10">
            <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-blue-500/30">
              <Zap className="text-blue-500 animate-pulse" size={32} />
            </div>
            <h3 className="text-2xl font-black text-white uppercase tracking-tighter mb-4">AI Audit Engine</h3>
            <p className="text-slate-400 font-medium text-lg mb-8">The BridgeOps Ramp-Up Readiness Score is currently being calibrated for enhanced precision.</p>
            <div className="inline-flex items-center space-x-3 bg-blue-600 px-8 py-4 text-white font-black uppercase tracking-widest text-xs shadow-2xl">
              <Loader2 className="animate-spin" size={16} />
              <span>...Coming Soon</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Form Section */}
        <div className="lg:col-span-5 space-y-8 print:hidden">
          <div className="bg-white p-8 border border-slate-200 shadow-sm rounded-sm">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 mb-8 flex items-center">
              <ClipboardCheck className="mr-2 text-blue-600" size={18} />
              Readiness Parameters
            </h3>
            
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Company / Project Name
                  <Tooltip text="The name of the organization or specific hardware product being assessed." />
                </label>
                <input 
                  type="text"
                  name="companyName"
                  value={formData.companyName}
                  onChange={handleInputChange}
                  placeholder="Enter project name..."
                  className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Product Category
                  <Tooltip text="The industry sector your product belongs to, which determines default regulatory requirements." />
                </label>
                <select 
                  name="productType"
                  value={formData.productType}
                  onChange={handleInputChange}
                  className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                >
                  {PRODUCT_SEGMENTS.map(segment => (
                    <option key={segment} value={segment}>{segment}</option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center">
                  <ShieldAlert className="mr-2 text-blue-600" size={14} />
                  Regulatory Standards
                  <Tooltip text="Compliance certifications and quality standards required for your specific product and target market." />
                </label>
                
                <div className="relative">
                  <button 
                    type="button"
                    onClick={() => setIsStandardsOpen(!isStandardsOpen)}
                    className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium text-left flex items-center justify-between focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                  >
                    <span className="truncate">
                      {formData.selectedStandards.length > 0 
                        ? `${formData.selectedStandards.length} selected` 
                        : "Select standards..."}
                    </span>
                    <ChevronRight size={16} className={`transition-transform duration-200 ${isStandardsOpen ? 'rotate-90' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {isStandardsOpen && (
                      <>
                        <div 
                          className="fixed inset-0 z-10" 
                          onClick={() => setIsStandardsOpen(false)}
                        ></div>
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute z-20 mt-1 w-full bg-white border border-slate-200 shadow-xl max-h-60 overflow-y-auto"
                        >
                          <div className="p-2 space-y-1">
                            {SEGMENT_STANDARDS[formData.productType]?.map(standard => (
                              <label 
                                key={standard} 
                                className="flex items-center p-3 hover:bg-slate-50 cursor-pointer transition-colors rounded-sm group"
                              >
                                <input 
                                  type="checkbox"
                                  checked={formData.selectedStandards.includes(standard)}
                                  onChange={() => toggleStandard(standard)}
                                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                                />
                                <span className="ml-3 text-xs font-bold text-slate-700 uppercase tracking-tight group-hover:text-blue-600 transition-colors">
                                  {standard}
                                </span>
                              </label>
                            ))}
                          </div>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    Complexity
                    <Tooltip text="The level of technical difficulty in design, components, and manufacturing processes." />
                  </label>
                  <select 
                    name="complexity"
                    value={formData.complexity}
                    onChange={handleInputChange}
                    className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    Supply Chain
                    <Tooltip text="The maturity, geographic distribution, and reliability of your supplier network." />
                  </label>
                  <select 
                    name="supplyChain"
                    value={formData.supplyChain}
                    onChange={handleInputChange}
                    className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium outline-none"
                  >
                    <option value="established">Established</option>
                    <option value="mixed">Mixed</option>
                    <option value="new">New/Unproven</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                    DMR Completeness
                    <Tooltip text="Device Master Record - the completeness of technical specs, BOM, and assembly instructions." />
                  </label>
                  <span className="text-[10px] font-bold text-blue-600">{formData.dmrCompleteness}%</span>
                </div>
                <input 
                  type="range" 
                  name="dmrCompleteness"
                  min="0" max="100"
                  value={formData.dmrCompleteness}
                  onChange={handleInputChange}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Product Testability Coverage
                    <Tooltip text="The extent to which manufacturing steps are verified by quality control tests." />
                  </label>
                  <span className="text-[10px] font-bold text-blue-600">{formData.testCoverage}%</span>
                </div>
                <input 
                  type="range" 
                  name="testCoverage"
                  min="0" max="100"
                  value={formData.testCoverage}
                  onChange={handleInputChange}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    ECO Governance
                    <Tooltip text="Engineering Change Order - how strictly design changes are controlled during production." />
                  </label>
                  <select 
                    name="ecoGovernance"
                    value={formData.ecoGovernance}
                    onChange={handleInputChange}
                    className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium outline-none"
                  >
                    <option value="strict">Strict/Automated</option>
                    <option value="loose">Loose/Manual</option>
                    <option value="none">None/Ad-hoc</option>
                  </select>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Critical Components Second Source
                      <Tooltip text="Percentage of critical BOM components that have at least one qualified alternative source." />
                    </label>
                    <span className="text-[10px] font-bold text-blue-600">{formData.criticalComponentsSecondSource}%</span>
                  </div>
                  <input 
                    type="range" 
                    name="criticalComponentsSecondSource"
                    min="0" max="100"
                    value={formData.criticalComponentsSecondSource}
                    onChange={handleInputChange}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Manufacturing Maturity
                    <Tooltip text="The overall readiness of the production processes and tools" />
                  </label>
                  <span className="text-[10px] font-bold text-blue-600">{formData.manufacturingMaturity}%</span>
                </div>
                <input 
                  type="range" 
                  name="manufacturingMaturity"
                  min="0" max="100"
                  value={formData.manufacturingMaturity}
                  onChange={handleInputChange}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    Number of Suppliers
                    <Tooltip text="Total count of unique suppliers involved in the Bill of Materials (BOM)." />
                  </label>
                  <input 
                    type="number" 
                    name="numSuppliers"
                    value={formData.numSuppliers}
                    onChange={handleInputChange}
                    className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium outline-none"
                    placeholder="e.g. 15"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    Monthly Volume
                    <Tooltip text="The planned production quantity per month at full scale." />
                  </label>
                  <input 
                    type="text" 
                    name="targetVolume"
                    value={formData.targetVolume}
                    onChange={handleInputChange}
                    className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium outline-none"
                    placeholder="e.g. 5000"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Product Design Maturity
                    <Tooltip text="Measures design stability and validation status (DVT/PVT). High maturity means the design is frozen and ready for mass production." />
                  </label>
                  <span className="text-[10px] font-bold text-blue-600">{formData.productDesignMaturity}%</span>
                </div>
                <input 
                  type="range" 
                  name="productDesignMaturity"
                  min="0" max="100"
                  value={formData.productDesignMaturity}
                  onChange={handleInputChange}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <button 
                onClick={runAssessment}
                disabled={loading}
                className="w-full bg-slate-900 hover:bg-blue-600 text-white py-4 font-black uppercase tracking-[0.2em] text-xs transition-all flex items-center justify-center group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="mr-3 animate-spin" />
                    Analyzing Data...
                  </>
                ) : (
                  <>
                    Calculate Readiness <Zap size={16} className="ml-3 group-hover:fill-current" />
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="p-6 bg-blue-50 border-l-4 border-blue-600">
            <div className="flex items-start">
              <Info className="text-blue-600 mr-3 mt-0.5 flex-shrink-0" size={18} />
              <p className="text-xs text-blue-800 font-medium leading-relaxed">
                This tool to analyze Ramp up readiness based on NPI (New Product Introduction) best practices. Results are indicative and should be followed by a professional audit.
              </p>
            </div>
          </div>
        </div>

        {/* Result Section */}
        <div className="lg:col-span-7">
          <AnimatePresence mode="wait">
            {!result && !loading && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-sm p-12 text-center"
              >
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                  <Activity className="text-slate-300" size={40} />
                </div>
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Awaiting Input</h3>
                <p className="text-slate-400 text-sm mt-2 max-w-xs">Complete the project parameters to generate your Readiness Score and Risk Analysis.</p>
              </motion.div>
            )}

            {loading && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center bg-white border border-slate-200 rounded-sm p-12 text-center"
              >
                <div className="relative mb-8">
                  <div className="w-24 h-24 border-4 border-slate-100 border-t-blue-600 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Factory className="text-blue-600" size={32} />
                  </div>
                </div>
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Processing Assessment</h3>
                <div className="mt-4 space-y-2">
                  <p className="text-slate-400 text-xs font-mono uppercase tracking-widest animate-pulse">Scanning DMR Integrity...</p>
                  <p className="text-slate-400 text-xs font-mono uppercase tracking-widest animate-pulse delay-75">Evaluating Supply Chain Stability...</p>
                  <p className="text-slate-400 text-xs font-mono uppercase tracking-widest animate-pulse delay-150">Calculating Risk Coefficients...</p>
                </div>
              </motion.div>
            )}

            {result && !loading && (
              <div 
                className="space-y-8"
                id="report-content"
              >
                {/* Admin Actions */}
                {isAdmin && (
                  <div className="flex justify-end space-x-4 no-print">
                    <button 
                      onClick={downloadPDF}
                      className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-500/20"
                    >
                      <Download size={14} />
                      <span>Download PDF Report</span>
                    </button>
                  </div>
                )}

                {/* Score Header */}
                <div className="bg-slate-900 text-white p-10 rounded-sm relative overflow-hidden print:bg-slate-900 print:text-white">
                  <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
                  <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                    <div className="text-left">
                      <span className="text-blue-500 font-black uppercase tracking-[0.3em] text-[10px] mb-2 block">Assessment Result</span>
                      <h2 className="text-3xl font-black uppercase tracking-tighter">Readiness Score</h2>
                      <div className="mt-2 flex items-center space-x-3">
                        <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-sm ${
                          result.riskLevel.includes('HIGH') ? 'bg-red-500 text-white' : 
                          result.riskLevel.includes('MEDIUM') ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'
                        }`}>
                          BridgeOps Ramp-Up Risk: {result.riskLevel}
                        </span>
                      </div>
                      <p className="text-slate-400 text-sm mt-4 max-w-sm leading-relaxed">{result.analysis}</p>
                    </div>
                    <div className="relative flex items-center justify-center">
                      <svg className="w-40 h-40 transform -rotate-90">
                        <circle
                          cx="80"
                          cy="80"
                          r="70"
                          stroke="currentColor"
                          strokeWidth="8"
                          fill="transparent"
                          className="text-slate-800"
                        />
                        <circle
                          cx="80"
                          cy="80"
                          r="70"
                          stroke="currentColor"
                          strokeWidth="8"
                          fill="transparent"
                          strokeDasharray={440}
                          strokeDashoffset={440 - (440 * result.score) / 100}
                          className="text-blue-500"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-4xl font-black tracking-tighter">{result.score}%</span>
                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Ready</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Freemium / Admin Content Logic */}
                <div className="relative">
                  {!isAdmin && (
                    <div className="absolute inset-0 z-30 backdrop-blur-md bg-white/40 flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-blue-200 no-print">
                      <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center mb-6 shadow-xl">
                        <Lock size={32} />
                      </div>
                      <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter mb-4">Detailed Report Locked</h3>
                      <p className="text-slate-600 font-medium max-w-md mb-8">
                        To receive the full audit report including **Risk Drivers**, **Strategic Mitigations**, and **Target Ramp KPIs**, please enter your email and contact us.
                      </p>

                      <div className="w-full max-w-md mb-6">
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 text-left">Your Email Address</label>
                        <input 
                          type="email"
                          name="clientEmail"
                          value={formData.clientEmail}
                          onChange={handleInputChange}
                          placeholder="email@company.com"
                          className="w-full bg-white border border-slate-200 px-4 py-4 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                        />
                      </div>
                      
                      <div className="w-full max-w-md">
                        <a 
                          href={`https://api.whatsapp.com/send?phone=972523760674&text=${encodeURIComponent(`
*Ramp Readiness Report Request*
----------------------------
*Company:* ${formData.companyName || 'N/A'}
*Client Email:* ${formData.clientEmail || 'N/A'}
*Readiness Score:* ${result.score}%
*Risk Level:* ${result.riskLevel}

*Project Parameters:*
- Category: ${formData.productType}
- Complexity: ${formData.complexity}
- Supply Chain: ${formData.supplyChain}
- DMR: ${formData.dmrCompleteness}%
- Test Coverage: ${formData.testCoverage}%
- Manufacturing Maturity: ${formData.manufacturingMaturity}%
- Product Design Maturity: ${formData.productDesignMaturity}%
- Critical Components Second Source: ${formData.criticalComponentsSecondSource}%
- ECO Governance: ${formData.ecoGovernance}
- Volume: ${formData.targetVolume}
- Suppliers: ${formData.numSuppliers}
- Standards: ${formData.selectedStandards.join(', ') || 'None'}

Hi Eran, I've completed the assessment and would like to receive the full detailed report.
                          `.trim())}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            if (!formData.clientEmail) {
                              e.preventDefault();
                              alert('Please enter your email first.');
                            }
                          }}
                          className={`w-full flex items-center justify-center space-x-3 bg-[#25D366] text-white px-8 py-5 font-black uppercase tracking-widest text-xs hover:scale-[1.02] active:scale-95 transition-all shadow-xl ${!formData.clientEmail ? 'opacity-50 grayscale cursor-not-allowed' : ''}`}
                        >
                          <MessageCircle size={20} />
                          <span>Request Full Report</span>
                        </a>
                        {!formData.clientEmail && (
                          <p className="mt-3 text-[10px] text-red-500 font-bold uppercase tracking-widest">
                            Please enter your email above to enable request
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className={!isAdmin ? 'opacity-20 pointer-events-none select-none' : ''}>
                    {/* Risks & Recommendations */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 print:grid-cols-2">
                      <div className="bg-white border border-slate-200 p-8 rounded-sm">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-6 flex items-center">
                          <AlertTriangle className="mr-2" size={14} />
                          Risk Drivers
                        </h4>
                        <ul className="space-y-4">
                          {result.risks.map((risk, idx) => (
                            <li key={idx} className="flex items-start group">
                              <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 mr-3 flex-shrink-0 group-hover:scale-125 transition-transform"></div>
                              <span className="text-sm font-medium text-slate-700 leading-tight">{risk}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="bg-white border border-slate-200 p-8 rounded-sm">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-6 flex items-center">
                          <CheckCircle2 className="mr-2" size={14} />
                          Recommended Mitigations
                        </h4>
                        <ul className="space-y-4">
                          {result.recommendations.map((action, idx) => (
                            <li key={idx} className="flex items-start group">
                              <div className="w-5 h-5 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mr-3 flex-shrink-0 text-[10px] font-black">
                                {idx + 1}
                              </div>
                              <span className="text-sm font-medium text-slate-700 leading-tight">{action}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* KPI Targets Section */}
                    <div className="bg-white border border-slate-200 p-8 rounded-sm print:border-slate-300 html2pdf__page-break">
                      <div className="flex items-center justify-between mb-8">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600 flex items-center">
                          <Gauge className="mr-2" size={14} />
                          Target Ramp KPIs
                        </h4>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">10 Critical Metrics</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 print:grid-cols-2">
                        {result.kpis.map((kpi, idx) => (
                          <div key={idx} className="group">
                            <div className="flex flex-col mb-2">
                              <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 group-hover:text-blue-500 transition-colors">{kpi.category}</span>
                              <span className="text-[10px] font-black text-slate-900 uppercase tracking-tight leading-tight min-h-[2.5rem]">{kpi.metric}</span>
                            </div>
                            <div className="bg-slate-50 p-3 border-l-2 border-blue-500 group-hover:bg-blue-50 transition-colors min-h-[8rem] flex flex-col justify-between">
                               <div className="text-lg font-black text-blue-600 tracking-tighter mb-2">{kpi.target}</div>
                               <p className="text-[9px] text-slate-500 font-medium leading-tight">{kpi.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Next Steps CTA */}
                <div className="bg-blue-600 p-8 rounded-sm flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="text-left">
                    <p className="text-blue-100 text-sm font-medium mb-4 leading-relaxed max-w-xl">
                      If your readiness score is below 70%, your ramp-up risk is significantly higher.
                      We provide a focused Ramp Readiness Audit to identify and close these gaps before scaling production.
                    </p>
                    <h4 className="text-white font-black uppercase tracking-tight text-lg">Need a detailed audit?</h4>
                    <p className="text-blue-100 text-sm font-medium">Get a professional on-site assessment</p>
                  </div>
                  <button 
                    onClick={() => {
                      const text = `Hi Eran, I'd like to book a consultation for a detailed Ramp Readiness Audit for my project.`;
                      window.open(`https://api.whatsapp.com/send?phone=972523760674&text=${encodeURIComponent(text)}`, '_blank');
                    }}
                    className="bg-white text-blue-600 px-8 py-3 font-black uppercase tracking-widest text-[10px] hover:bg-slate-900 hover:text-white transition-all whitespace-nowrap no-print"
                  >
                    Book Consultation
                  </button>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    )}

    {/* Admin Toggle - Subtle internal access */}
    <div className="mt-20 pt-10 border-t border-slate-100 flex justify-center pb-10 print:hidden">
      <button 
        onClick={() => isAdmin ? setIsAdmin(false) : setShowLogin(true)}
        className="text-[10px] text-slate-300 hover:text-slate-500 uppercase tracking-widest transition-colors flex items-center"
      >
        <Lock size={10} className="mr-1" />
        {isAdmin ? "Switch to Client View" : "Admin Login"}
      </button>
    </div>

    <AnimatePresence>
      {showLogin && (
        <AdminLogin 
          onLogin={() => {
            setIsAdmin(true);
            setShowLogin(false);
          }}
          onClose={() => setShowLogin(false)}
        />
      )}
    </AnimatePresence>
  </div>
);
};

export default RampScoreTool;
