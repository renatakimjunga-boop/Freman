export type ExtensionCategory =
  | "Productivity"
  | "Developer tools"
  | "Privacy"
  | "Web3"
  | "Interface";

export interface ExtensionSample {
  id: string;
  name: string;
  description: string;
  category: ExtensionCategory;
  apis: string[];
  source: string;
}

const SAMPLES_REPO =
  "https://github.com/GoogleChrome/chrome-extensions-samples/tree/main";

/**
 * A curated catalog drawn from the official chrome-extensions-samples
 * repository, plus the Web3-native samples that ship with Axiom.
 */
export const EXTENSION_SAMPLES: ExtensionSample[] = [
  {
    id: "page-redder",
    name: "Page Redder",
    description:
      "The hello-world of extension development — tints the active tab with a single scripting call.",
    category: "Interface",
    apis: ["activeTab", "scripting"],
    source: `${SAMPLES_REPO}/functional-samples/sample.page-redder`,
  },
  {
    id: "webauthn-passkeys",
    name: "WebAuthn Passkeys",
    description:
      "Register and authenticate with platform passkeys straight from a side panel.",
    category: "Privacy",
    apis: ["webAuthn", "sidePanel"],
    source: `${SAMPLES_REPO}/functional-samples/sample.webauthn`,
  },
  {
    id: "tab-groups",
    name: "Tab Groups",
    description:
      "Group, colour and reorder tabs declaratively with the tabGroups API.",
    category: "Productivity",
    apis: ["tabGroups", "tabs"],
    source: `${SAMPLES_REPO}/api-samples/tabGroups`,
  },
  {
    id: "cookie-inspector",
    name: "Cookie Inspector",
    description:
      "A DevTools panel that inspects and edits cookies for the site you're on.",
    category: "Developer tools",
    apis: ["cookies", "devtools"],
    source: `${SAMPLES_REPO}/api-samples/devtools/panels`,
  },
  {
    id: "emoji-weather",
    name: "Emoji Weather",
    description:
      "Popup that renders the local forecast as pure emoji via the Geolocation API.",
    category: "Interface",
    apis: ["action", "geolocation"],
    source: `${SAMPLES_REPO}/functional-samples/sample.emoji-weather`,
  },
  {
    id: "water-alarm",
    name: "Water Alarm",
    description:
      "Scheduled notifications that keep you hydrated through long build runs.",
    category: "Productivity",
    apis: ["alarms", "notifications"],
    source: `${SAMPLES_REPO}/api-samples/alarms`,
  },
  {
    id: "mvc-architecture",
    name: "MVC Architecture",
    description:
      "Reference model-view-controller architecture for complex extension UIs.",
    category: "Developer tools",
    apis: ["storage", "tabs"],
    source: `${SAMPLES_REPO}/functional-samples/sample.mvc-architecture`,
  },
  {
    id: "keylogger-warning",
    name: "Keylogger Warning",
    description:
      "Content script that detects page-level keystroke listeners and warns you in real time.",
    category: "Privacy",
    apis: ["contentScripts", "storage"],
    source: `${SAMPLES_REPO}/functional-samples/sample.keylogger-warning`,
  },
  {
    id: "wallet-provider",
    name: "Wallet Provider",
    description:
      "Injects an EIP-1193 window.ethereum provider into every frame — the wallet's front door.",
    category: "Web3",
    apis: ["scripting", "contentScripts"],
    source: `${SAMPLES_REPO}/functional-samples/sample.wallet-provider`,
  },
  {
    id: "ens-resolver",
    name: "ENS Resolver",
    description:
      "Resolves .eth names typed in the omnibox and routes them to canonical addresses.",
    category: "Web3",
    apis: ["omnibox", "storage"],
    source: `${SAMPLES_REPO}/functional-samples/sample.ens-resolver`,
  },
  {
    id: "signature-guard",
    name: "Signature Guard",
    description:
      "Decodes eth_sign payloads and shows a human-readable warning before you approve.",
    category: "Web3",
    apis: ["scripting", "notifications"],
    source: `${SAMPLES_REPO}/functional-samples/sample.signature-guard`,
  },
  {
    id: "tab-capture",
    name: "Tab Capture",
    description:
      "Captures and records the active tab stream with the tabCapture API.",
    category: "Developer tools",
    apis: ["tabCapture", "offscreen"],
    source: `${SAMPLES_REPO}/api-samples/tabCapture`,
  },
];

export const EXTENSION_CATEGORIES: ExtensionCategory[] = [
  "Web3",
  "Productivity",
  "Developer tools",
  "Privacy",
  "Interface",
];
