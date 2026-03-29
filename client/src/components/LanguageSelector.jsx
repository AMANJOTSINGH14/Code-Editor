import React from "react";

const languages = ["javascript", "typescript", "python", "java", "go", "rust", "csharp"];

/**
 * Language selector component.
 * @param {Object} props - Component props.
 * @param {string} props.language - Current language.
 * @param {Function} props.onChange - Change handler.
 * @returns {JSX.Element} Selector component.
 */
export default function LanguageSelector({ language, onChange }) {
  return (
    <select
      value={language}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-xs"
    >
      {languages.map((lang) => (
        <option key={lang} value={lang}>
          {lang}
        </option>
      ))}
    </select>
  );
}
