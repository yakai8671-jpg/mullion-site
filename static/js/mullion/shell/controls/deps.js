/* What this module uses of other modules, handed in by setup (index.js). */
export let CONTROLS;
export let ICONS;
export let ITEM_TYPES;
export let TEXT_LANGUAGES;
export let VALUE_TYPES;
export let animateCardResize;
export let appSettingValue;
export let attachPort;
export let attachSink;
export let blobToDataUrl;
export let buildCardHead;
export let cardIsShrunk;
export let closeHint;
export let describeImage;
export let describeProperty;
export let explainer;
export let fitCardHead;
export let foldIcon;
export let formatAxis;
export let formatBytes;
export let formatValue;
export let hasCardSize;
export let hintButton;
export let imageFacts;
export let listCard;
export let locate;
export let makePortBadge;
export let openIconPicker;
export let openPopup;
export let openValuePicker;
export let optionsOf;
export let paintCardTools;
export let paintStatusRow;
export let pickLanguage;
export let portInfo;
export let portIsEntry;
export let portKey;
export let portLink;
export let portShare;
export let refreshAll;
export let registerControl;
export let setCardShrunk;
export let setCardSizeClass;
export let syncPortBadge;
export let t;
export let unlinkPort;
export let ResizeObserver;
export let document;
export let getComputedStyle;
export let requestAnimationFrame;
export let window;

export let fetch;

export let languages;
export let applyButton;
export let diffChildren;
export let emptyGuide;
export let setValue;
export let stepperButton;

export let location;

export let writeText;

export function connect(apis) {
  ({ writeText } = apis.clipboard);
  ({ applyButton, diffChildren, emptyGuide, setValue, stepperButton } = apis.parts);
  ({ formatValue } = apis.values);
  ({ fetch } = apis.server);
  ({ ResizeObserver, document, getComputedStyle, requestAnimationFrame, window, location } = apis.page);
  ({ t, languages } = apis.i18n);
  ({ CONTROLS, ICONS, ITEM_TYPES, VALUE_TYPES, describeProperty, registerControl } = apis.registry);
  ({ TEXT_LANGUAGES, blobToDataUrl, describeImage, formatAxis, formatBytes, imageFacts, optionsOf, pickLanguage } = apis.properties);
  ({ locate } = apis.media);
  ({ animateCardResize, buildCardHead, cardIsShrunk, closeHint, fitCardHead, foldIcon, hasCardSize, hintButton, listCard, makePortBadge, openPopup, paintCardTools, paintStatusRow, setCardShrunk, setCardSizeClass, syncPortBadge } = apis.view);
  ({ appSettingValue } = apis.apps);
  ({ attachPort, attachSink, explainer, refreshAll } = apis.mount);
  ({ portInfo, portIsEntry, portKey, portLink, portShare, unlinkPort } = apis.ports);
  ({ openIconPicker, openValuePicker } = apis.pickers);
}
