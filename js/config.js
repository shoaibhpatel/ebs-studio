// Public configuration. The publishable key is safe to ship (RLS protects data).
// Never put a service-role / secret key in this app.
export const SUPABASE_URL = 'https://lclgimxprqdquhyljkcm.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hfchYERLUocV13ZbVBSfWA_2TpzFsqN';

// Pinned CDN dependencies (exact versions)
export const CDN = {
  supabase: 'https://esm.sh/@supabase/supabase-js@2.118.0',
  pdfmake: 'https://cdn.jsdelivr.net/npm/pdfmake@0.3.12/build/pdfmake.min.js',
  pdfmakeVfs: 'https://cdn.jsdelivr.net/npm/pdfmake@0.3.12/build/vfs_fonts.js',
  // Serif display font for PDF titles/totals (Playfair Display, OFL). TTF first, WOFF fallback.
  serifFonts: {
    normal: [
      'https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@5.2.8/latin-400-normal.ttf',
      'https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5.2.8/files/playfair-display-latin-400-normal.woff',
    ],
    bold: [
      'https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@5.2.8/latin-600-normal.ttf',
      'https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5.2.8/files/playfair-display-latin-600-normal.woff',
    ],
    italics: [
      'https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@5.2.8/latin-400-italic.ttf',
      'https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5.2.8/files/playfair-display-latin-400-italic.woff',
    ],
  },
};

export const DEFAULT_PROJECT_TYPES = [
  'Wedding Photography', 'Pre Wedding', 'Engagement', 'Birthday', 'Maternity',
  'Newborn', 'Album Designing', 'Graphic Designing', 'Video Editing', 'Custom Project',
];
export const PROJECT_STATUSES = ['Inquiry', 'Booked', 'In Progress', 'Completed', 'Cancelled'];
export const STAGES = ['booking', 'shoot', 'editing', 'album', 'delivered'];
export const STAGE_LABEL = { booking: 'Booking', shoot: 'Shoot', editing: 'Editing', album: 'Album', delivered: 'Delivered' };
export const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'];
export const EXPENSE_CATEGORIES = ['Printing', 'Lamination', 'Album Box', 'Paper', 'Courier', 'Designer', 'Travel', 'Equipment', 'Staff', 'Office', 'Other'];
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected'];

// ---------- Team & tasks ----------
export const JOB_TITLES = ['Photographer', 'Candid Photographer', 'Videographer', 'Cinematographer', 'Drone Operator', 'Editor', 'Album Designer', 'Assistant', 'Other'];
export const TASK_STATUSES = ['assigned', 'in_progress', 'done', 'cancelled'];
export const TASK_STATUS_LABEL = { assigned: 'Assigned', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' };
export const PAYOUT_MODES = ['Cash', 'UPI', 'Bank Transfer'];
/** Quick work-title chips in the Assign work modal (job-specific first, then the general list). */
export const WORK_CHIPS = {
  Photographer: ['Traditional photography', 'Candid photography', 'Photo editing'],
  'Candid Photographer': ['Candid photography', 'Candid + portraits', 'Photo editing'],
  Videographer: ['Traditional videography', 'Video editing'],
  Cinematographer: ['Cinematic videography', 'Highlight film', 'Video editing'],
  'Drone Operator': ['Drone'],
  Editor: ['Photo editing', 'Video editing'],
  'Album Designer': ['Album design'],
  Assistant: ['Assistant', 'Lighting assistant'],
};
export const WORK_CHIPS_ALL = ['Candid photography', 'Traditional videography', 'Drone', 'Album design', 'Video editing', 'Photo editing'];

// ---------- Keyboard shortcuts ----------
// Single-key shortcuts for quick "New …" actions and navigation.
// `id` ties a "new" shortcut to its entry in app.js NEW_ITEMS (matched by item text).
// Shortcuts are ignored while typing in a field, when a modal/overlay is open,
// or when a modifier key (Ctrl/Cmd/Alt) is held (except the documented Ctrl+K search).
// Keeping this list in one place keeps the handler, the New menu hints,
// and the Settings docs section in sync.
export const SHORTCUTS = [
  { key: 'i', kbd: 'I', label: 'New invoice', item: 'Invoice' },
  { key: 'q', kbd: 'Q', label: 'New quotation', item: 'Quotation' },
  { key: 'l', kbd: 'L', label: 'New lead', item: 'Lead' },
  { key: 'c', kbd: 'C', label: 'New customer', item: 'Customer' },
  { key: 'p', kbd: 'P', label: 'New project', item: 'Project' },
  { key: 'r', kbd: 'R', label: 'New payment', item: 'Payment' },
  { key: 'e', kbd: 'E', label: 'New expense', item: 'Expense' },
  { key: 'a', kbd: 'A', label: 'New album order', item: 'Album order' },
  { key: 't', kbd: 'T', label: 'Assign work', item: 'Assign work' },
  { key: 'y', kbd: 'Y', label: 'Team payout', item: 'Team payout' },
  { key: 'd', kbd: 'D', label: 'Go to dashboard', nav: '/dashboard' },
];
// Extra fixed shortcuts (handled specially, shown in Settings docs).
export const SHORTCUTS_EXTRA = [
  { kbd: '/', label: 'Search' },
  { kbd: 'Ctrl K', label: 'Search' },
  { kbd: 'Esc', label: 'Close menu / dialog' },
];
