
import React, { useState } from 'react';
import { Send, Phone, Mail } from 'lucide-react';

const ContactForm: React.FC = () => {
  const [formState, setFormState] = useState({ name: '', email: '', company: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submitted:', formState);
    setSubmitted(true);
    // In a real app, this would send data to a backend
  };

  if (submitted) {
    return (
      <div className="bg-white p-12 rounded-3xl shadow-xl border border-slate-100 text-center">
        <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Send size={40} />
        </div>
        <h3 className="text-3xl font-bold text-slate-900 mb-4">Message Sent!</h3>
        <p className="text-slate-600 mb-8">Thank you for reaching out. I'll get back to you within 24 hours.</p>
        <button 
          onClick={() => setSubmitted(false)}
          className="text-blue-600 font-bold hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <div id="contact" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-slate-900 rounded-[3rem] overflow-hidden shadow-2xl flex flex-col lg:flex-row">
          
          <div className="lg:w-1/3 p-12 bg-blue-600 text-white flex flex-col justify-between">
            <div>
              <h2 className="text-4xl font-bold mb-6">Let's build something <span className="text-blue-200">extraordinary</span> together.</h2>
              <p className="text-blue-100 text-lg mb-12">Whether you need a short-term NPI sprint or long-term operational scaling, I'm here to help.</p>
              
              <div className="space-y-6">
                <div className="flex items-center space-x-4">
                  <div className="bg-white/20 p-3 rounded-xl"><Mail size={24} /></div>
                  <span className="font-medium">OpsBridgENG@gmail.com</span>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="bg-white/20 p-3 rounded-xl"><Phone size={24} /></div>
                  <span className="font-medium">+972-52-376-0674</span>
                </div>
              </div>
            </div>

            <div className="mt-12 pt-12 border-t border-white/20">
              <p className="text-sm font-bold uppercase tracking-widest text-blue-200">Based In</p>
              <p className="text-lg">Israel / Global Operations</p>
            </div>
          </div>

          <div className="lg:w-2/3 p-12 lg:p-20 bg-white">
            <h3 className="text-2xl font-bold text-slate-900 mb-8">Send a message</h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Full Name</label>
                <input 
                  required
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="John Doe"
                  onChange={(e) => setFormState({...formState, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Email Address</label>
                <input 
                  required
                  type="email" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="john@company.com"
                  onChange={(e) => setFormState({...formState, email: e.target.value})}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-bold text-slate-700">Company Name</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="Acme Inc."
                  onChange={(e) => setFormState({...formState, company: e.target.value})}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-bold text-slate-700">Project Details</label>
                <textarea 
                  required
                  rows={4}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="Tell me about your project needs..."
                  onChange={(e) => setFormState({...formState, message: e.target.value})}
                ></textarea>
              </div>
              <div className="md:col-span-2 pt-4">
                <button 
                  type="submit" 
                  className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition-all flex items-center justify-center space-x-2"
                >
                  <span>Request Consultation</span>
                  <Send size={20} />
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
