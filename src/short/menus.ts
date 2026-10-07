/**
 * Every option menu from CONTRACT.md as Record<id, description>. Descriptions
 * tell Jev (a classifier, not a generator) WHEN that option is the right
 * pick — concrete and content-based, never "none unless X" phrasing (that
 * biases a classifier toward always answering none). It's weak at counting
 * and numbers, strong at semantic/topical matching, so descriptions lean on
 * meaning ("lists alternatives"), not counts ("has 3 items").
 */
import { ALL_TEMPLATE_IDS, UNDER_CHIN_TEMPLATES, type TemplateId } from "./types";

export const STYLE_FAMILY_MENU: Record<string, string> = {
  apple_glass:
    "Deep charcoal aurora background, translucent glass cards with bright inner highlights, SF Pro display type, accent glow bleeding past the card edge — polished product-keynote feel.",
  bold_kinetic:
    "Poster-black background with full-bleed accent corner slabs, fat condensed ALL-CAPS headlines with a thick black outline, hard offset sticker shadows, square edges — loud, confrontational creator hype.",
  terminal_type:
    "Near-black CRT screen, phosphor-green monospace throughout, scanlines, bracket-framed panes and a sweeping cursor bar, wide-tracked micro-caps labels — developer, hacker, technical-proof feel.",
  neon_cyber:
    "Violet-black night with a drifting magenta/cyan aurora and a horizon grid, glowing outlined cards and pill chips, tight uppercase Helvetica — futuristic, gaming, late-night cyberpunk.",
  paper_editorial:
    "Warm cream paper stock with visible fibre grain, New York serif headlines, solid ink kicker blocks, hairline rules and rotated square/dot/ring ornaments — magazine essay and long-form journalism.",
  clean_swiss:
    "Paper-white grid, pure white cards capped by a heavy black top rule, zero rounding, huge tight-tracked Helvetica, monospace meta rows on the top and bottom edges, one saturated accent used sparingly — Swiss design-system rigour.",
  gradient_pop:
    "Saturated multi-blob gradient mesh background, chunky white pill cards with very large radii, bouncy Avenir type and candy accent gradients — consumer app, lifestyle and social content.",
  dark_luxe:
    "Obsidian black with a slow vertical sheen, a single champagne-gold hairline frame, high-contrast Didot set light with very wide tracking, almost no ornament — premium, finance, luxury brand. Always reads gold regardless of the accent picked.",
};

export const ACCENT_MENU: Record<string, string> = {
  blue: "Cobalt into electric sky-blue. Calm, trustworthy, engineering and tech-product mood.",
  green: "Mint into lime. Growth, money, shipping, go/positive mood.",
  yellow: "Sun-yellow into ember-orange. High-energy, attention-grabbing, warning/highlight mood.",
  orange: "Burnt orange into warm amber. Friendly, casual, energetic mood.",
  red: "Cinema crimson into coral. Urgent, bold, stop/risk mood.",
  pink: "Hot orchid pink into warm gold. Playful, youthful, social/creator mood.",
  purple: "Violet into lilac. Creative, premium, imaginative mood.",
  cyan: "Deep teal into aqua. Crisp, digital, data and product-UI mood.",
};

export const CAPTION_STYLE_MENU: Record<string, string> = {
  word_pop: "2-3 heavy outlined words at a time; the spoken word snaps up in accent colour with a glow — punchy, the short-form default.",
  single_word: "One huge outlined word on screen at a time, punching in with each spoken word — maximal emphasis, very high energy.",
  karaoke_line: "The whole line is on screen, upcoming words held back in grey while an accent bar swipes under each word as it is spoken — readable, calmer pacing.",
  boxed_highlight: "The spoken word sits in a glowing accent gradient pill inside the line — bold, high-contrast, brand-forward.",
  typewriter_line: "A monospace line typed out character by character with a caret — deliberate, narrative, documentary feel.",
  anton_karaoke: "Tall condensed ALL-CAPS words, three at a time, the spoken word lighting up yellow like a karaoke bar — loud, trailer-style, high-energy talk.",
  archivo_chip: "Heavy black-weight words with the spoken word sitting in a red chip — attention-grabbing, opinionated, news-flash and hot-take delivery.",
  inter_editorial: "Clean bold sans lowercase lines with emphasised words flipping to a large italic serif, spoken word brightening — calm, thoughtful, editorial explainer.",
};

/** Opening hook looks: a giant 24fps title that sits behind the speaker for the first ~3 s. */
export const HOOK_MENU: Record<string, string> = {
  giant_word: "One giant ALL-CAPS keyword of the opening line fills the frame behind the speaker's head, with a short line beneath — the opening makes a bold claim or names the subject.",
  giant_number: "A giant number or statistic stands behind the speaker's head — the opening leads with a figure, a count, a price, or a time span.",
  giant_question: "A giant question word or phrase hangs behind the speaker — the opening asks a question or poses a puzzle the video will answer.",
  focus_word: "A tall solid keyword rises behind the speaker with a small monospace label in front — the opening introduces a tool, product, or technical topic.",
  ghost_topic: "The topic word is cropped along the top edge, with a faint outlined echo beside it — the opening sets up a subject calmly, a softer start with no shouting.",
};

export const TEXT_EFFECT_MENU: Record<string, string> = {
  typewriter: "Text types out character by character — deliberate, explanatory reveal.",
  word_pop: "Words pop in one at a time with a small scale bounce — punchy, energetic reveal.",
  slide_up: "Text slides up into place from below — smooth, modern reveal.",
  blur_in: "Text resolves from blurred to sharp — soft, cinematic reveal.",
  scramble_decode: "Text scrambles through random characters before settling — techy, data/reveal moment.",
  highlighter_swipe: "A highlight color swipes across the text as it appears — emphasis on a key phrase.",
  scale_punch: "Text snaps in at an oversized scale then settles — high-impact, hype moment.",
  mask_reveal: "Text is revealed by a moving wipe/mask edge — clean, graphic-design reveal.",
};

export const TRANSITION_MENU: Record<string, string> = {
  hard_cut: "No transition effect — a plain instant cut, the default when nothing else fits.",
  flash: "A quick white flash on the cut — punctuates a punchline or sudden reveal.",
  whip_streak: "A fast directional motion-blur streak — energetic shift to a new example or list item.",
  glass_wipe: "A frosted-glass wipe across the frame — smooth topic change within the same segment.",
  zoom_blur: "A radial zoom blur on the cut — dramatic emphasis into a big statement.",
  glitch_slice: "A digital glitch/slice distortion on the cut — techy or disruptive beat change.",
};

/** template -> { description, underChin } */
export const TEMPLATE_MENU: Record<TemplateId, { description: string; underChin: boolean }> = {
  big_statement: {
    description: "The beat makes one short, punchy, standalone claim or takeaway worth restating as headline text.",
    underChin: true,
  },
  stamp: {
    description: "A hard limitation, guarantee, or absolute: can't, never, zero, impossible, no X — a stamped verdict word.",
    underChin: true,
  },
  keyword_pill: {
    description: "A single key term or short label is worth pinning on screen as a small pill/tag while the speaker keeps talking.",
    underChin: true,
  },
  stat_number: {
    description: "The speaker states one specific number, percentage, or measurement worth showing big (a stat callout).",
    underChin: true,
  },
  versus: {
    description: "The speaker directly contrasts or compares two things against each other (X vs Y, this instead of that).",
    underChin: false,
  },
  option_chips: {
    description: "The speaker lists alternatives to pick between (A or B or C), a multiple-choice-style question or set of choices.",
    underChin: false,
  },
  confidence_meter: {
    description: "The speaker expresses how sure or confident something is, as a fill level or meter rather than a plain percent stat.",
    underChin: false,
  },
  yes_no: {
    description: "A yes/no question is posed, or the speaker gives a probability leaning toward yes or no.",
    underChin: false,
  },
  scale_slider: {
    description: "A rating or score is placed somewhere on a named scale between two or more labeled endpoints (e.g. calm to furious).",
    underChin: false,
  },
  numbered_point: {
    description: "The speaker SAYS an explicit ordinal word or number for this beat (\"one\", \"first\", \"two\", \"3\", etc) marking it as an item in a list they're walking through. If the beat has no spoken ordinal, this is a poor fit — prefer another template even if the beat is list-like in content.",
    underChin: false,
  },
  checklist: {
    description: "The speaker names several short items that belong together as a checklist or set of features/requirements.",
    underChin: false,
  },
  chat_bubble: {
    description: "The speaker quotes or role-plays something someone said or typed, like a message, question, or dialogue line.",
    underChin: false,
  },
  definition: {
    description: "The speaker defines or explains what a term/concept means in a short explanatory phrase.",
    underChin: false,
  },
  icon_row: {
    description: "The speaker names a small set of concrete categories or things that each pair naturally with a simple icon/emoji.",
    underChin: false,
  },
  code_terminal: {
    description: "The speaker references code, a command, an API call, or terminal-style technical syntax.",
    underChin: false,
  },
  flow_steps: {
    description: "The speaker describes a process or sequence of steps that happen one after another (a pipeline or workflow).",
    underChin: false,
  },
  dual_stat: {
    description: "The speaker states two related numbers side by side worth comparing at a glance (e.g. before/after, cost/speed).",
    underChin: false,
  },
  quote: {
    description: "The beat's own wording is quotable and self-contained enough to display as a pull-quote.",
    underChin: false,
  },
};

export function templateChoiceCriteria(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ALL_TEMPLATE_IDS) out[id] = TEMPLATE_MENU[id].description;
  return out;
}

export function isUnderChin(id: TemplateId): boolean {
  return UNDER_CHIN_TEMPLATES.has(id);
}

export const SFX_MENU: Record<string, string> = {
  none: "No sound effect fits this beat.",
  whoosh: "Fast motion, a transition, or a quick directional move.",
  pop: "A small element or short text appearing/popping on screen.",
  ding: "A positive confirmation, success, or checkmark moment.",
  riser: "Tension building before a reveal or punchline just ahead.",
  impact: "A punchline, bold claim, or hard emphasis moment landing.",
};

export const ENERGY_SCORE_CRITERIA: string[] = [
  "Calm — measured, explanatory, low-key delivery throughout.",
  "Moderate — normal conversational energy, some emphasis.",
  "Lively — upbeat, animated delivery with clear enthusiasm.",
  "Hype — high-intensity, fast, excited, maximal-energy delivery.",
];
