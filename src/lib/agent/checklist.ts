import type { Job } from "../model";

// What the shop requires a close-out to record, by call type. This is the ground truth the
// agent's checklist is checked against (the shop's domain expert sets it, not the model).
// SYNTHETIC stand-in until the design-partner shop sends its real list.

export interface ShopItem {
  id: string;
  text: string;
}

const COMMON_START: ShopItem[] = [
  { id: "complaint", text: "The reported problem, and which system or zone had it (when the house has more than one)" },
  { id: "equipment", text: "The equipment worked on: make and model, from the nameplate when there is a photo" },
];

const COMMON_END: ShopItem[] = [
  { id: "repair", text: "The repair done and the result after it (what was tested and what it showed)" },
  { id: "parts", text: "Parts and materials used, each with its size, rating or amount" },
  { id: "recommendation", text: "Any recommendation, the technician's reason for it, and the price quoted from the price book" },
];

export const SHOP_CHECKLISTS: Record<NonNullable<Job["callType"]>, ShopItem[]> = {
  "no-heat": [
    ...COMMON_START,
    { id: "cause", text: "The cause found, with the readings or error codes that showed it" },
    { id: "filter", text: "Filter condition, and whether it was changed" },
    ...COMMON_END,
  ],
  "no-cool": [
    ...COMMON_START,
    { id: "cause", text: "The cause found, with the readings that showed it" },
    { id: "performance", text: "Refrigerant pressures or temperatures after the repair (e.g. supply/return temperature split)" },
    {
      id: "refrigerant",
      text: "Refrigerant added: type and amount; if any was added, whether a leak was searched for and what was found",
    },
    ...COMMON_END,
  ],
  maintenance: [
    ...COMMON_START,
    { id: "readings", text: "The readings taken during the visit" },
    { id: "filter", text: "Filter condition, and whether it was changed" },
    ...COMMON_END,
  ],
};

export function shopChecklist(job: Job): ShopItem[] {
  return SHOP_CHECKLISTS[job.callType ?? "maintenance"];
}
