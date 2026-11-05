import React from 'react';
import { Calendar } from 'lucide-react';

interface DatePickerFieldProps {
  label?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  className?: string;
}

export const DatePickerField: React.FC<DatePickerFieldProps> = ({
  label,
  required,
  value,
  onChange,
  placeholder = 'YYYY-MM-DD',
  helperText,
  className = '',
}) => {
  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label className="block text-xs font-medium text-slate-300">
          {label} {required && <span className="text-rose-400">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
        />
      </div>
      {helperText && <p className="text-[10px] text-slate-500">{helperText}</p>}
    </div>
  );
};
