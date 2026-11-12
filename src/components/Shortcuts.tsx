import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";

/** The single source of truth for key bindings, in the same order and wording as Calendar's and Notes' lists. */
const SHORTCUTS: [keys: string[], label: StringKey][] = [
  [["Ctrl", "K"], "scSearch"],
  [["I"], "scImport"],
  [["N"], "scNew"],
  [["E"], "scEdit"],
  [["F"], "scFavorite"],
  [["Ctrl", "B"], "scSidebar"],
  [["."], "scPanel"],
  [["Ctrl", ","], "settings"],
  [["Ctrl", "Enter"], "scSave"],
  [["Esc"], "scClose"],
];

export function ShortcutList() {
  const { t } = useSettings();
  return (
    <div className="shortcut-list">
      {SHORTCUTS.map(([keys, label]) => (
        <div key={label} className="shortcut">
          <span>{t(label)}</span>
          <span className="keys">
            {keys.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
