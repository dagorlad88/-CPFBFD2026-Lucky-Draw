export interface PrizeConfig {
  prizeNumber: string;
  prizeName: string;
  imageUrl: string;
}

const slotImageFileNames: Record<number, string> = {
  1: 'slot_1_iphone17',
  2: 'slot_2_samsungtab',
  3: 'slot_3_apple_neo',
  4: 'slot_4_nintendo_switch2',
  5: 'slot_5_ps5',
  6: 'slot_6_insta360-X4-Starter-Bundle',
  7: 'slot_7_2D1N-Stay-and-Breakfast-for-2-at-Hotel-Ora',
  8: 'slot_8_Samsung-Galaxy-Watch-8-LTE-44MM',
  9: 'slot_9_Shark-Turbo-Blade-TF200',
  10: 'slot_10_Oceanarium-Tickets',
};

function getSlotImageUrl(slot: number): string {
  const fileName = slotImageFileNames[slot];
  return new URL(`../../test-data/image/${fileName}.jpg`, import.meta.url).href;
}

function rankLabel(slot: number): string {
  return `Prize #${slot.toString().padStart(2, '0')}`;
}

// Update these values directly to define the default designation/title for Rank 1-10.
export const TOP10_PRIZE_TITLES: Record<number, string> = {
  1: 'Rank 01 - iPhone 17 Pro 256GB',
  2: 'Rank 02 - Samsung Galaxy Tab S11 256GB',
  3: 'Rank 03 - Macbook Neo, 256GB',
  4: 'Rank 04 - Nintendo Switch 2',
  5: 'Rank 05 - Playstation 5 - Digital Version',
  6: 'Rank 06 - Insta360 X4 Starter Bundle',
  7: 'Rank 07 - 2D1N Stay and Breakfast for 2 at Hotel Ora',
  8: 'Rank 08 - Samsung Galaxy Watch 8 LTE 44MM',
  9: 'Rank 09 - Shark Turbo Blade TF200',
  10: 'Rank 10 - 2x $50 RWS Vouchers and 2 x Oceanarium Tickets',
};

export const DEFAULT_TOP10_PRIZES: Record<number, PrizeConfig> = Array.from(
  { length: 10 },
  (_, index) => index + 1
).reduce((acc, slot) => {
  acc[slot] = {
    prizeNumber: rankLabel(slot),
    prizeName: TOP10_PRIZE_TITLES[slot] || `Rank ${slot.toString().padStart(2, '0')} - Update Designation`,
    imageUrl: getSlotImageUrl(slot),
  };
  return acc;
}, {} as Record<number, PrizeConfig>);

export function mergeWithDefaultTop10(
  incoming: Record<number, Partial<PrizeConfig> | undefined>
): Record<number, PrizeConfig> {
  const merged: Record<number, PrizeConfig> = {};

  for (let slot = 1; slot <= 10; slot++) {
    const override = incoming[slot] ?? {};
    merged[slot] = {
      ...DEFAULT_TOP10_PRIZES[slot],
      ...override,
      prizeNumber: rankLabel(slot),
    };
  }

  return merged;
}
