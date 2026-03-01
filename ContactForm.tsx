
import React, { useState } from 'react';
import { Send, Mail, MessageSquare, MapPin, MessageCircle, Linkedin } from 'lucide-react';

const ContactForm: React.FC = () => {
  const [formState, setFormState] = useState({ name: '', email: '', company: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  const whatsappNumber = "972523760674";
  const linkedInUrl = "https://www.linkedin.com/in/eran-hakun-81a80a1b";
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const messageBody = `*New Professional Inquiry - OpsBridge Engineering*\n--------------------------------------------\n*Name:* ${formState.name}\n*Email:* ${formState.email}\n*Company/Market:* ${formState.company}\n*Challenge:* ${formState.message}\n--------------------------------------------\n_Sent via OpsBridge Website_`;
    const whatsappLink = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(messageBody)}`;
    window.open(whatsappLink, '_blank');
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div id="contact" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-slate-900 p-12 lg:p-20 text-center shadow-2xl relative overflow-hidden">
             <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
            <div className="w-16 h-16 bg-blue-600 text-white flex items-center justify-center mx-auto mb-6 relative z-10">
              <MessageCircle size={32} />
            </div>
            <h3 className="text-2xl font-black text-white mb-4 relative z-10 uppercase tracking-tighter">Redirecting to WhatsApp</h3>
            <p className="text-slate-400 mb-8 text-base relative z-10">The inquiry details have been prepared for WhatsApp. If the chat didn't open automatically, please click below.</p>
            <div className="flex flex-col items-center space-y-4">
              <button 
                onClick={() => setSubmitted(false)}
                className="text-blue-500 font-black hover:text-blue-400 transition-colors uppercase tracking-widest text-[10px] relative z-10"
              >
                Send Another Message
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="contact" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white border-2 border-slate-900 shadow-2xl flex flex-col lg:flex-row min-h-[600px]">
          <div className="lg:w-1/3 p-10 bg-slate-900 text-white flex flex-col justify-between relative overflow-hidden">
            <div className="absolute inset-0 blueprint-grid-dark opacity-10"></div>
            <div className="relative z-10 text-left">
              <div className="inline-block bg-blue-600 px-3 py-1 mb-6">
                <span className="text-[9px] font-black uppercase tracking-widest text-white">Direct Line</span>
              </div>
              <h2 className="text-3xl font-black mb-6 leading-tight uppercase tracking-tighter">Engineering <br/><span className="text-blue-500 text-4xl italic">Advisory</span></h2>
              <p className="text-slate-400 text-base mb-10 font-medium leading-relaxed">Let's discuss how we can stabilize your production line and improve your gross margins.</p>
              <div className="space-y-8">
                <a 
                  href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent("Hello Eran, I'm reaching out via your website.")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-6 group"
                >
                  <div className="bg-white/10 p-3 transition-colors group-hover:bg-blue-600">
                    <MessageSquare size={20} className="text-blue-500 group-hover:text-white" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">WhatsApp</span>
                    <span className="font-black text-xl tracking-tighter">+972-52-376-0674</span>
                  </div>
                </a>

                <a 
                  href={linkedInUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-6 group"
                >
                  <div className="bg-white/10 p-3 transition-colors group-hover:bg-blue-600">
                    <Linkedin size={20} className="text-blue-500 group-hover:text-white" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">LinkedIn</span>
                    <span className="font-bold text-sm tracking-tight text-white hover:text-blue-400 transition-colors">Connect on LinkedIn</span>
                  </div>
                </a>
              </div>
            </div>
            <div className="mt-12 pt-8 border-t border-white/10 relative z-10 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-500 mb-1 text-left">HQ</p>
                <p className="text-xs font-bold">Israel | Global Ops</p>
              </div>
              <MapPin size={20} className="text-slate-700" />
            </div>
          </div>
          <div className="lg:w-2/3 p-10 lg:p-16 bg-white">
            <div className="mb-10 text-left">
              <h3 className="text-3xl font-black text-slate-900 mb-2 tracking-tighter uppercase">Inquiry Form</h3>
              <p className="text-sm text-slate-500 font-medium">This form will prepare a message for WhatsApp for an immediate response.</p>
            </div>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-10 text-left">
              <div className="space-y-3">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                  <div className="w-3 h-[1px] bg-blue-600 mr-2"></div>Full Name
                </label>
                <input required type="text" className="w-full bg-slate-50 border-b-2 border-slate-200 px-4 py-2.5 focus:outline-none focus:border-blue-600 transition-all font-bold text-sm text-slate-800" placeholder="e.g. Michael Chen" value={formState.name} onChange={(e) => setFormState({...formState, name: e.target.value})} />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                   <div className="w-3 h-[1px] bg-blue-600 mr-2"></div>Business Email
                </label>
                <input required type="email" className="w-full bg-slate-50 border-b-2 border-slate-200 px-4 py-2.5 focus:outline-none focus:border-blue-600 transition-all font-bold text-sm text-slate-800" placeholder="michael@startup.io" value={formState.email} onChange={(e) => setFormState({...formState, email: e.target.value})} />
              </div>
              <div className="space-y-3 md:col-span-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                   <div className="w-3 h-[1px] bg-blue-600 mr-2"></div>Company & Market
                </label>
                <input type="text" className="w-full bg-slate-50 border-b-2 border-slate-200 px-4 py-2.5 focus:outline-none focus:border-blue-600 transition-all font-bold text-sm text-slate-800" placeholder="Company Name | Industry Sector" value={formState.company} onChange={(e) => setFormState({...formState, company: e.target.value})} />
              </div>
              <div className="space-y-3 md:col-span-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                   <div className="w-3 h-[1px] bg-blue-600 mr-2"></div>Operational Challenge
                </label>
                <textarea required rows={3} className="w-full bg-slate-50 border-b-2 border-slate-200 px-4 py-2.5 focus:outline-none focus:border-blue-600 transition-all font-bold text-sm text-slate-800 resize-none" placeholder="Describe your current bottleneck..." value={formState.message} onChange={(e) => setFormState({...formState, message: e.target.value})}></textarea>
              </div>
              <div className="md:col-span-2 pt-6">
                <button type="submit" className="w-full bg-slate-900 text-white py-4 font-black text-base hover:bg-green-600 transition-all flex items-center justify-center group uppercase tracking-widest shadow-xl">
                  <MessageCircle size={18} className="mr-4" />
                  <span>Transmit Form</span>
                  <Send size={18} className="ml-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactForm;
