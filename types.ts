
// All routable views in the app. Used by hash routing in App.tsx
// and accepted by `onNavigate` props throughout the component tree.
export type View =
  | 'home'
  | 'services'
  | 'methodology'
  | 'about'
  | 'contact'
  | 'ramp_score'
  | 'pricing'
  | 'dashboard'
  | 'intelligence'
  | 'suppliers';

export type NavigateFn = (view: View) => void;

export interface ServiceItem {
  id: string;
  title: string;
  description: string;
  addedValue: string;
  image: string;
  icon: string;
}

export interface Achievement {
  id: string;
  title: string;
  company: string;
  year: string;
}
