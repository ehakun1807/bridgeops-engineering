
import React from 'react';
import { DetailedServiceItem } from '../constants';
import { ICON_MAP } from '../constants';

interface ServiceCardProps {
  service: DetailedServiceItem;
}

const ServiceCard: React.FC<ServiceCardProps> = ({ service }) => {
  const IconComponent = ICON_MAP[service.icon];

  return (
    <div className="group bg-white rounded-none flex flex-col h-full border border-slate-200 relative">
      <div className="relative h-56 overflow-hidden bg-slate-100">
        <img 
          src={service.image} 
          alt={service.title} 
          className="w-full h-full object-cover grayscale opacity-80 mix-blend-multiply transition-all duration-700 group-hover:scale-105 group-hover:grayscale-0 group-hover:opacity-100"
        />
        <div className="absolute inset-0 bg-blue-900/10 pointer-events-none group-hover:bg-transparent transition-colors"></div>
        
        <div className="absolute bottom-4 left-4 bg-white p-2.5 shadow-sm border border-slate-100">
          {IconComponent && <IconComponent size={20} className="text-blue-600" />}
        </div>
      </div>
      
      <div className="p-10 flex flex-col flex-grow relative">
        <h3 className="text-xl font-extrabold text-slate-900 mb-6 tracking-tight group-hover:text-blue-600 transition-colors uppercase">
          {service.title}
        </h3>
        <p className="text-slate-500 text-sm leading-relaxed mb-8 flex-grow font-medium">
          {service.description}
        </p>
        
        <div className="pt-8 border-t border-slate-100">
          <div className="flex items-center mb-3">
            <span className="w-1.5 h-1.5 bg-blue-600 rounded-full mr-2"></span>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Business Impact</p>
          </div>
          <p className="text-slate-800 font-bold text-sm leading-snug">
            {service.addedValue}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ServiceCard;
