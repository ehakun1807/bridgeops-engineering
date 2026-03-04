
import React, { useState } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronRight, 
  ClipboardCheck, 
  Cpu, 
  Factory, 
  FileText, 
  Gauge, 
  Info, 
  Layers, 
  Loader2, 
  ShieldAlert, 
  TrendingUp,
  Zap
} from 'lucide-react';

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
  "Medical Device": ["ISO 13485 (QMS)", "FDA 21 CFR 820", "ISO 14971 (Risk)", "IEC 60601 (Safety)", "ISO 27001 (Cyber)"],
  "Agrotech": ["ISO 11783 (ISOBUS)", "CE Marking", "IP67/68 Rating", "ISO 27001 (Cyber)"],
  "Military / Defense": ["MIL-STD-810", "ITAR Compliance", "AS9100", "NIST 800-171 (Cyber)"],
  "Automotive": ["IATF 16949", "ISO 26262 (Safety)", "APQP/PPAP", "ISO 21434 (Cyber)"],
  "Consumer Electronics": ["CE / FCC", "RoHS / WEEE", "UL Listing", "ISO 27001 (Cyber)"],
  "Industrial Automation / Robotics": ["ISO 10218 (Safety)", "Machinery Directive", "IEC 61131", "ISO 27001 (Cyber)"],
  "Aerospace": ["AS9100", "DO-178C / DO-254", "FAA Certification", "ISO 27001 (Cyber)"],
  "Telecommunications": ["NEBS Compliance", "ETSI Standards", "FCC Part 15", "ISO 27001 (Cyber)"],
  "Energy / CleanTech": ["ISO 50001", "UL 1741", "IEC 61730", "ISO 27001 (Cyber)"],
  "IoT Devices": ["ISO 27001 (Cyber)", "GDPR Compliance", "SAR Testing", "RED Directive"],
  "Wearables": ["ISO 27001 (Cyber)", "Biocompatibility", "SAR Testing", "CE / FCC"],
  "Other Hardware": ["ISO 9001", "CE / FCC", "ISO 27001 (Cyber)"]
};

const IS_COMING_SOON = true;

const RampScoreTool: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [isStandardsOpen, setIsStandardsOpen] = useState(false);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [formData, setFormData] = useState({
    complexity: 'medium',
    supplyChain: 'mixed',
    dmrCompleteness: 50,
    testCoverage: 40,
    ecoGovernance: 'loose',
    targetVolume: '1000',
    numSuppliers: '10',
    assemblySteps: '25',
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
    setFormData(prev => ({
      ...prev,
      selectedStandards: prev.selectedStandards.includes(standard)
        ? prev.selectedStandards.filter(s => s !== standard)
        : [...prev.selectedStandards, standard]
    }));
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
            Assembly Steps: ${formData.assemblySteps}
            Supply Chain Maturity: ${formData.supplyChain}
            DMR (Device Master Record) Completeness: ${formData.dmrCompleteness}%
            Product Testability Coverage: ${formData.testCoverage}%
            ECO (Engineering Change Order) Governance: ${formData.ecoGovernance}
            Target Production Volume: ${formData.targetVolume} units/month
            Target Regulatory Standards: ${formData.selectedStandards.join(', ') || 'None specified'}
            
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
        <div className="lg:col-span-5 space-y-8">
          <div className="bg-white p-8 border border-slate-200 shadow-sm rounded-sm">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 mb-8 flex items-center">
              <ClipboardCheck className="mr-2 text-blue-600" size={18} />
              Readiness Parameters
            </h3>
            
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Product Category</label>
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
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Complexity</label>
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
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Supply Chain</label>
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
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">DMR Completeness</label>
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
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Product Testability Coverage</label>
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
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">ECO Governance</label>
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
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Monthly Volume</label>
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Number of Suppliers</label>
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
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Assembly Steps</label>
                  <input 
                    type="number" 
                    name="assemblySteps"
                    value={formData.assemblySteps}
                    onChange={handleInputChange}
                    className="w-full bg-slate-50 border border-slate-200 px-4 py-3 text-sm font-medium outline-none"
                    placeholder="e.g. 30"
                  />
                </div>
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
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
              >
                {/* Score Header */}
                <div className="bg-slate-900 text-white p-10 rounded-sm relative overflow-hidden">
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
                        <motion.circle
                          cx="80"
                          cy="80"
                          r="70"
                          stroke="currentColor"
                          strokeWidth="8"
                          fill="transparent"
                          strokeDasharray={440}
                          initial={{ strokeDashoffset: 440 }}
                          animate={{ strokeDashoffset: 440 - (440 * result.score) / 100 }}
                          transition={{ duration: 1.5, ease: "easeOut" }}
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

                {/* Risks & Recommendations */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                <div className="bg-white border border-slate-200 p-8 rounded-sm">
                  <div className="flex items-center justify-between mb-8">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600 flex items-center">
                      <Gauge className="mr-2" size={14} />
                      Target Ramp KPIs
                    </h4>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">10 Critical Metrics</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
                  <button className="bg-white text-blue-600 px-8 py-3 font-black uppercase tracking-widest text-[10px] hover:bg-slate-900 hover:text-white transition-all whitespace-nowrap">
                    Book Consultation
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    )}
  </div>
);
};

export default RampScoreTool;
