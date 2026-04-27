
export interface SubIndicator {
  title: string;
  tools: string[];
  question: string;
}

export interface ReadinessIndicator {
  title: string;
  subIndicators: SubIndicator[];
}

export const READINESS_INDICATORS: ReadinessIndicator[] = [
  {
    title: "Product Design Maturity",
    subIndicators: [
      { 
        title: "Design freeze/BOM", 
        tools: ["CDR/DFMEA"], 
        question: "Is the design frozen and the BOM fully structured?" 
      },
      { 
        title: "ECO rate", 
        tools: ["#R&DECOs/month"], 
        question: "Is the Engineering Change Order rate stable enough for production?" 
      },
      { 
        title: "DFM/DFA completion", 
        tools: ["Subcontractors Reports"], 
        question: "Has the design been optimized for easy assembly and fabrication?" 
      }
    ]
  },
  {
    title: "Product Testability",
    subIndicators: [
      { 
        title: "Test time", 
        tools: ["DFT"], 
        question: "Is the cycle time for testing optimized for high volume?" 
      },
      { 
        title: "Test coverage", 
        tools: ["DFT"], 
        question: "Does the test procedure cover 100% of critical quality requirements?" 
      },
      { 
        title: "Test equipment readiness", 
        tools: ["Ramp-Up Validation"], 
        question: "Is the necessary test equipment built, calibrated and ready?" 
      }
    ]
  },
  {
    title: "Manufacturing Process Definition",
    subIndicators: [
      { 
        title: "Work instructions", 
        tools: ["WIs"], 
        question: "Are clear, documented work instructions available for operators?" 
      },
      { 
        title: "Process flow", 
        tools: ["PFD"], 
        question: "is the manufacturing sequence fully mapped and validated?" 
      },
      { 
        title: "PFMEA", 
        tools: ["PFMEA"], 
        question: "Have potential process failures been identified and mitigated?" 
      }
    ]
  },
  {
    title: "Tooling & Equipment Readiness",
    subIndicators: [
      { 
        title: "Qualification", 
        tools: ["IQ/OQ/PQ"], 
        question: "Have all machines undergone Installation, operational and performance qualification?" 
      },
      { 
        title: "Capacity", 
        tools: ["Capacity Analysis"], 
        question: "Can the current tooling meet the forecasted ramp-up demand?" 
      },
      { 
        title: "Stability", 
        tools: ["Minimal Manual Testing"], 
        question: "Are jigs and fixtures stable enough for repeatable output?" 
      }
    ]
  },
  {
    title: "Supply Chain Readiness",
    subIndicators: [
      { 
        title: "Supplier qualification", 
        tools: ["Tier-1/2 Audits"], 
        question: "Are all Tier-1 and Tier-2 suppliers audited and certified?" 
      },
      { 
        title: "Lead times (LLI)", 
        tools: ["Lead Time Analysis"], 
        question: "Are Long Lead Items (LLI) secured with sufficient buffer?" 
      },
      { 
        title: "Logistics", 
        tools: ["Incoterms/Shipping"], 
        question: "Is the logistics chain from components to assembly fully established?" 
      }
    ]
  },
  {
    title: "Critical Components Second Source",
    subIndicators: [
      { 
        title: "% single source components", 
        tools: ["Buffer Stock"], 
        question: "What percentage of the BOM is single-sourced?" 
      },
      { 
        title: "Risk components", 
        tools: ["RA List"], 
        question: "Are critical/rare components identified with a mitigation plan?" 
      },
      { 
        title: "EOL/Obsolete", 
        tools: ["Notification Process"], 
        question: "Is there a process for tracking End-of-Life components?" 
      }
    ]
  },
  {
    title: "Yield Maturity",
    subIndicators: [
      { 
        title: "Pilot yield (FPY)", 
        tools: ["FAI"], 
        question: "What is the First Pass Yield (FPY) from the pilot runs?" 
      },
      { 
        title: "Scrap", 
        tools: ["# of scrap"], 
        question: "is scrap level within the planned budget for ramp?" 
      },
      { 
        title: "Rework", 
        tools: ["# of rework"], 
        question: "Are rework procedures documented and validated?" 
      }
    ]
  },
  {
    title: "Configuration Control",
    subIndicators: [
      { 
        title: "BOM control", 
        tools: ["PLM Tool"], 
        question: "Is the BOM managed in a centralized, version-controlled system?" 
      },
      { 
        title: "Revision tracking", 
        tools: ["ECO Process"], 
        question: "Can you trace every unit built to its specific design revision?" 
      },
      { 
        title: "Full DMR/documentation", 
        tools: ["GDP Compliance"], 
        question: "is the Device Master Record (DMR) complete and up to date?" 
      }
    ]
  },
  {
    title: "Operations Readiness",
    subIndicators: [
      { 
        title: "Trained operators", 
        tools: ["Training Plan"], 
        question: "Have all line operators been trained and certified for their tasks?" 
      },
      { 
        title: "Production procedures", 
        tools: ["WIs/SOPs"], 
        question: "Are Standard Operating Procedures (SOPs) available on-site?" 
      },
      { 
        title: "Escalation paths", 
        tools: ["Troubleshooting"], 
        question: "is there a clear escalation path for technical/quality issues?" 
      }
    ]
  },
  {
    title: "Production Ramp Capacity",
    subIndicators: [
      { 
        title: "Capacity analysis", 
        tools: ["Line set up"], 
        question: "Is the production floor layout optimized for the ramp volume?" 
      },
      { 
        title: "Takt time vs. Demand", 
        tools: ["Takt time study"], 
        question: "Does the line Takt time match the forecasted customer demand?" 
      },
      { 
        title: "Bottleneck processes", 
        tools: ["Throughput study"], 
        question: "Have all bottlenecks been identified and resolved?" 
      }
    ]
  },
  {
    title: "Servicability",
    subIndicators: [
      { 
        title: "MTBF/MTTF", 
        tools: ["Reliability Testing"], 
        question: "is the product reliability data validated for field use?" 
      },
      { 
        title: "RMA", 
        tools: ["RMA Process"], 
        question: "is the Return Merchandise Authorization process established?" 
      },
      { 
        title: "FRU", 
        tools: ["Field Replaceable Units"], 
        question: "Are Field Replaceable Units identified and stocked?" 
      }
    ]
  },
  {
    title: "Quality",
    subIndicators: [
      { 
        title: "Incoming Inspection", 
        tools: ["IQC"], 
        question: "are critical components inspected upon arrival (IQC)?" 
      },
      { 
        title: "NC/CAPA", 
        tools: ["Non-Conformance"], 
        question: "is there a system for handling Non-Conformances and CAPA?" 
      },
      { 
        title: "Traceability", 
        tools: ["Component Traceability"], 
        question: "is there serial-level traceability for critical components?" 
      }
    ]
  }
];
