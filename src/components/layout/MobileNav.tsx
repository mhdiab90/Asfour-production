import React from 'react';
import { 
  LayoutDashboard, 
  PlusCircle, 
  FileText, 
  Database, 
  BarChart3, 
  Settings 
} from 'lucide-react';
import { NavigationPage } from '../../types';
import { useAuth } from '../../context/AuthContext';

interface MobileNavProps {
  currentPage: NavigationPage;
  onNavigate: (page: NavigationPage) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentPage, onNavigate }) => {
  const { isProductionUser } = useAuth();

  const adminItems = [
    { id: 'dashboard' as NavigationPage, label: 'الرئيسية', icon: LayoutDashboard },
    { id: 'production-entry' as NavigationPage, label: 'إدخال', icon: PlusCircle },
    { id: 'production-records' as NavigationPage, label: 'السجلات', icon: FileText },
    { id: 'master-data' as NavigationPage, label: 'البيانات', icon: Database },
    { id: 'reports' as NavigationPage, label: 'التقارير', icon: BarChart3 },
    { id: 'settings' as NavigationPage, label: 'الإعدادات', icon: Settings },
  ];

  const operatorItems = [
    { id: 'production-entry' as NavigationPage, label: 'تسجيل الإنتاج', icon: PlusCircle },
    { id: 'production-records' as NavigationPage, label: 'سجلات اليوم', icon: FileText },
  ];

  const items = isProductionUser ? operatorItems : adminItems;

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900 border-t border-slate-800 px-2 py-1.5 flex items-center justify-around shadow-2xl">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = currentPage === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`flex flex-col items-center justify-center py-1 px-4 rounded-lg transition-colors cursor-pointer ${
              isActive
                ? isProductionUser
                  ? 'text-slate-950 bg-amber-500 font-bold'
                  : 'text-white bg-indigo-600 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};
