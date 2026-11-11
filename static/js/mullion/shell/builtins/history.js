import { ITEM_TYPES, registerApp, registerItemType, registerTranslations } from "./deps.js";
import { NODES, row, t } from "./deps.js";


// What it shows is the history itself: its own edits are left out of it.

// What this file registers, once the modules it uses are handed in (index.js).
export function install() {
  registerTranslations({
    en: {
      "mu.history.title": "Operation history",
      "mu.history.apply": "Apply",
      "mu.history.applyTitle": "Make this history entry current",
      "mu.history.window": "Window",
      "mu.history.app": "App",
      "mu.history.item": "Item",
      "mu.history.property": "Property",
      "mu.history.control": "Control",
      "mu.history.initial": "Starting state",
      "mu.history.layout": "Change layout",
      "mu.history.add": "Open / add: {name}",
      "mu.history.remove": "Close / remove: {name}",
      "mu.history.edit": "Edit: {name} · {key}",
      "mu.history.current": "Current",
      "mu.history.future": "Undone",
      "mu.history.done": "Applied",
      "mu.history.state": "State",
      "mu.history.time": "Time",
      "mu.history.hint": "Apply makes the selected entry current. Keeps the last 100 changes until reload. Set app exclusions in App List; changing exclusions starts a new history. Excluded app values and card UI stay live; shared window layout restores saved positions and sizes. Files, saved presets, profile settings and external jobs are outside this history. Ctrl/Cmd+Z: undo; Ctrl+Y or Ctrl/Cmd+Shift+Z: redo. Text fields use their own undo.",
    },
    ja: {
      "mu.history.title": "操作履歴",
      "mu.history.apply": "適用",
      "mu.history.applyTitle": "この履歴を現在の状態にする",
      "mu.history.window": "ウィンドウ",
      "mu.history.app": "アプリ",
      "mu.history.item": "アイテム",
      "mu.history.property": "プロパティ",
      "mu.history.control": "コントロール",
      "mu.history.initial": "開始時の状態",
      "mu.history.layout": "レイアウトを変更",
      "mu.history.add": "開く・追加：{name}",
      "mu.history.remove": "閉じる・削除：{name}",
      "mu.history.edit": "編集：{name} · {key}",
      "mu.history.current": "現在",
      "mu.history.future": "取り消し済み",
      "mu.history.done": "適用済み",
      "mu.history.state": "状態",
      "mu.history.time": "時刻",
      "mu.history.hint": "「適用」で選んだ履歴を現在の状態にします。このタブの直近100件を再読み込みまで保持します。アプリ一覧で除外を設定でき、変更すると現在の状態から履歴を開始します。除外アプリの値とカード表示は現在の状態を保ち、ウィンドウ間の配置とサイズは履歴に従って復元します。ファイル、保存済みプリセット、全体設定、外部ジョブは対象外です。Ctrl/Cmd+Z：元に戻す、Ctrl+Y または Ctrl/Cmd+Shift+Z：やり直す。入力欄では文字編集のアンドゥを使います。",
    },
  });
  registerApp("history", { home: "mullion", homeOrder: 40, excludeHistory: true });
  registerItemType("history", {
    label: "mu.history.title",
    standalone: true,
    icon: "clock-history",
    permissions: ["history:read", "history:write"],
    properties: {},
    body(api) {
      const { entries } = api.history.state();
      const label = (entry) => {
        const def = ITEM_TYPES[entry.type];
        const spec = def?.properties?.[entry.key];
        return t(`mu.history.${entry.kind}`, {
          name: def ? t(def.label) : entry.type || "",
          key: spec ? t(spec.label || entry.key) : entry.key || "",
        });
      };
      const named = (name, id) => [name, id].filter(Boolean).join(" · ");
      const details = (entry) => (entry.targets || []).flatMap((target, index) => [
        target.windowId && row(`${index}-window`, t("mu.history.window"), named(target.windowName, target.windowId)),
        target.appId && row(`${index}-app`, t("mu.history.app"), named(target.appName, target.appId)),
        target.itemId && row(`${index}-item`, t("mu.history.item"), named(target.itemName, target.itemId)),
        target.propertyKey && row(`${index}-property`, t("mu.history.property"), named(target.propertyName, target.propertyKey)),
        (target.controlName || target.controlType) && row(`${index}-control`, t("mu.history.control"), named(target.controlName, target.controlType)),
      ].filter(Boolean));
      const cards = entries.slice().reverse().map((entry) =>
        NODES.card(`operation-${entry.id}`, label(entry), [
          NODES.props(`details-${entry.id}`, [
            row("time", t("mu.history.time"), new Date(entry.time).toLocaleTimeString()),
            row("state", t("mu.history.state"), t(entry.current ? "mu.history.current" : entry.future ? "mu.history.future" : "mu.history.done")),
            ...details(entry),
          ]),
        ], [{
          key: "apply",
          primary: true,
          icon: "check2",
          label: t("mu.history.apply"),
          title: t("mu.history.applyTitle"),
          disabled: entry.current,
          run: () => api.history.restore(entry.id),
        }], { isListElement: true })
      );
      return [
        NODES.section("history", t("mu.history.title"), [
          NODES.listCard("history-list", cards, { icon: "clock-history" }),
        ], { hint: t("mu.history.hint") }),
      ];
    },
  });
}
