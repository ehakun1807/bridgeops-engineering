import React, { useState } from 'react';
import { Send, Mail, MessageSquare } from 'lucide-react';

const ContactForm: React.FC = () => {
  const [formState, setFormState] = useState({ name: '', email: '', company: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  // WhatsApp Configuration
  const whatsappNumber = "972523760674";
  const whatsappMessage = encodeURIComponent("Hello Eran, I'm reaching out via your website and would like to discuss engineering and operations services.");
  const whatsappLink = `https://wa.me/${whatsappNumber}?text=${whatsappMessage}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submitted:', formState);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div id="contact" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-slate-900 rounded-[3rem] p-12 lg:p-20 text-center shadow-2xl">
            <div className="w-20 h-20 bg-green-500 text-white rounded-full flex items-center justify-center mx-auto mb-6">
              <Send size={40} />
            </div>
            <h3 className="text-3xl font-bold text-white mb-4">Message Sent Successfully!</h3>
            <p className="text-slate-400 mb-8 text-lg">Thank you for reaching out. I will get back to you shortly.</p>
            <button 
              onClick={() => setSubmitted(false)}
              className="text-blue-400 font-bold hover:text-blue-300 transition-colors uppercase tracking-widest text-sm"
            >
              Send Another Message
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="contact" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-slate-900 rounded-[3rem] overflow-hidden shadow-2xl flex flex-col lg:flex-row">
          
          <div className="lg:w-1/3 p-12 bg-blue-600 text-white flex flex-col justify-between">
            <div>
              <h2 className="text-4xl font-black mb-6 leading-tight">Build <br/><span className="text-blue-200 text-5xl">Scalable Ops</span> <br/>With Us.</h2>
              <p className="text-blue-100 text-lg mb-12 font-medium">Ready to transition from development to high-yield mass production? Let's talk.</p>
              
              <div className="space-y-6">
                <a href="mailto:OpsBridgENG@gmail.com" className="flex items-center space-x-4 hover:bg-white/10 p-3 -ml-3 rounded-2xl transition-all group">
                  <div className="bg-white/20 p-3 rounded-xl group-hover:bg-white/30 transition-colors"><Mail size={24} /></div>
                  <span className="font-bold tracking-tight">OpsBridgENG@gmail.com</span>
                </a>
                
                <a 
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-4 hover:bg-white/10 p-3 -ml-3 rounded-2xl transition-all group"
                >
                  <div className="bg-white/20 p-3 rounded-xl group-hover:bg-white/30 transition-colors">
                    <MessageSquare size={24} />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="font-black text-xl">+972-52-376-0674</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-200">Click to WhatsApp</span>
                  </div>
                </a>
              </div>
            </div>

            <div className="mt-12 pt-12 border-t border-white/20">
              <p className="text-sm font-black uppercase tracking-widest text-blue-200 mb-2">Based In</p>
              <p className="text-lg font-bold">Israel / Global Support</p>
            </div>
          </div>

          <div className="lg:w-2/3 p-12 lg:p-20 bg-white">
            <h3 className="text-3xl font-black text-slate-900 mb-8 tracking-tighter">Request a Consultation</h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Full Name</label>
                <input 
                  required
                  type="text" 
                  className="w-full bg-slate-50 border-b-2 border-slate-200 px-0 py-4 focus:outline-none focus:border-blue-600 transition-all font-bold text-slate-800"
                  placeholder="John Doe"
                  value={formState.name}
                  onChange={(e) => setFormState({...formState, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Email Address</label>
                <input 
                  required
                  type="email" 
                  className="w-full bg-slate-50 border-b-2 border-slate-200 px-0 py-4 focus:outline-none focus:border-blue-600 transition-all font-bold text-slate-800"
                  placeholder="name@company.com"
                  value={formState.email}
                  onChange={(e) => setFormState({...formState, email: e.target.value})}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Company Name</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border-b-2 border-slate-200 px-0 py-4 focus:outline-none focus:border-blue-600 transition-all font-bold text-slate-800"
                  placeholder="Your Startup / Organization"
                  value={formState.company}
                  onChange={(e) => setFormState({...formState, company: e.target.value})}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Project Details</label>
                <textarea 
                  required
                  rows={4}
                  className="w-full bg-slate-50 border-b-2 border-slate-200 px-0 py-4 focus:outline-none focus:border-blue-600 transition-all font-bold text-slate-800 resize-none"
                  placeholder="Tell us about your operational challenges..."
                  value={formState.message}
                  onChange={(e) => setFormState({...formState, message: e.target.value})}
                ></textarea>
              </div>
              <div className="md:col-span-2 pt-6">
                <button 
                  type="submit" 
                  className="w-full bg-slate-900 text-white py-5 rounded-sm font-black text-lg hover:bg-blue-600 transition-all flex items-center justify-center space-x-3 group uppercase tracking-widest shadow-xl"
                >
                  <span>Submit Request</span>
                  <Send size={20} className="ml-3 group-hover:translate-x-1 transition-transform" />
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