import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { setUILang } from "@workspace/api-client-react";

export type Lang = "th" | "en";
const STORAGE_KEY = "ticker_lang";

function loadLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "th" || v === "en") return v;
  } catch {}
  return "en";
}

export interface Strings {
  // ── Profile — stat labels ────────────────────────────────────────
  followers: string;
  followingLabel: string;
  // ── Profile — buttons ────────────────────────────────────────────
  follow: string;
  followingBtn: string;
  requested: string;
  requestFollow: string;
  message: string;
  editProfile: string;
  // ── Profile — empty states ────────────────────────────────────────
  noFollowers: string;
  noFollowing: string;
  noMovieCards: string;
  createCard: string;
  // ── Movie detail ─────────────────────────────────────────────────
  tickerCommunity: string;
  noOnePosted: string;
  postedCards: string;
  cardsUnit: string;
  dateLocale: string;
  datePlaceholder: string;
  // ── Calendar (date picker) ────────────────────────────────────────
  calMonths: string[];
  calDays: string[];
  // ── Settings — level badge labels ────────────────────────────────
  myLevel: string;
  levelStart: string;
  levelEarned: string;
  levelLocked: string;
  maxLevel: string;
  maxXp: string;
  nextLevel: (n: number) => string;
  // ── Settings — misc labels ────────────────────────────────────────
  darkTheme: string;
  darkThemeDesc: string;
  privateProfile: string;
  privateProfileDesc: string;
  trash: string;
  trashDesc: string;
  pushNotifications: string;
  pushNotificationsDesc: string;
  pushBlockedTitle: string;
  pushBlockedAndroidPwa: string;
  pushBlockedDesktop: string;
  pushPromptTitle: string;
  pushPromptBody: string;
  pushPromptEnable: string;
  pushPromptLater: string;
  adminPanel: string;
  adminPanelDesc: string;
  contactTicker: string;
  contactTickerDesc: string;
  supportTicker: string;
  supportTickerDesc: string;
  logout: string;
  logoutDesc: string;
  // ── Settings — language row ───────────────────────────────────────
  language: string;
  langTh: string;
  langEn: string;
  // ── Settings — trash section ──────────────────────────────────────
  deletePermanentlyIn: (days: number) => string;
  willDeleteSoon: string;
  restore: string;
  purge: string;
  moviesCount: (n: number) => string;
  chainTimes: string;
  movieCount: string;
  episodeRatings: string;
  purgeTitle: string;
  purgeDesc: string;
  purgeCannotRecover: string;
  // ── Settings — badge ──────────────────────────────────────────────
  noBadgeYet: string;
  badgeNames: Record<number, { name: string; desc: string }>;
  // ── Chat ─────────────────────────────────────────────────────────
  chatTitle: string;
  searchNamePlaceholder: string;
  noChats: string;
  noChatsDesc: string;
  manageChat: string;
  leaveConv: string;
  leaveConvTitle: string;
  leaveConvDesc: string;
  cancelBtn: string;
  confirmBtn: string;
  deletingLabel: string;
  noMessages: string;
  imageMsg: string;
  messageRequestsLabel: (n: number) => string;
  messagesLabel: string;
  // ── Chat conversation ─────────────────────────────────────────────
  deletedCard: string;
  deletedMsg: string;
  deleteMessageTitle: string;
  deleteMessageDesc: string;
  messageOptions: string;
  copyMessage: string;
  deleteMessage: string;
  uploadImageError: string;
  imageLoadError: string;
  typePlaceholder: string;
  messageRequestFrom: (name: string) => string;
  // ── Notifications ─────────────────────────────────────────────────
  notifTitle: string;
  searchNotifsPlaceholder: string;
  noNotifs: string;
  noNotifsDesc: string;
  acceptBtn: string;
  declineBtn: string;
  acceptedLabel: string;
  declinedLabel: string;
  approveBtn: string;
  denyBtn: string;
  respondedLabel: string;
  // ── Party invite ──────────────────────────────────────────────────
  partyInviteFrom: string;
  partySizeLabel: (n: number) => string;
  chooseSeat: string;
  seatTakenHint: string;
  yourRating: string;
  alreadyAccepted: string;
  errSeatTaken: string;
  errDuplicateMovie: string;
  errGeneric: string;
  errChooseSeat: string;
  errGiveRating: string;
  // ── Party invite — expired (origin card deleted before friend accepted) ─
  expiredLabel: string;
  partyExpiredTitle: string;
  partyExpiredDesc: string;
  // ── Home ─────────────────────────────────────────────────────────
  noTicketsFeed: string;
  noUserFound: string;
  noUserFoundDesc: string;
  searchUsersPlaceholder: string;
  // ── Search ───────────────────────────────────────────────────────
  searchMoviePlaceholder: string;
  noSearchResults: string;
  emptySection: string;
  sections: Record<string, { title: string; desc: string }>;
  // ── Following feed ────────────────────────────────────────────────
  noPostsYet: string;
  noPostsYetDesc: string;
  // ── Bookmarks ─────────────────────────────────────────────────────
  bookmarksTitle: string;
  tabAll: string;
  noBookmarks: string;
  noBookmarksDesc: string;
  noMovieBookmarks: string;
  noMovieBookmarksDesc: string;
  noTicketBookmarks: string;
  noTicketBookmarksDesc: string;
  noChainBookmarks: string;
  noChainBookmarksDesc: string;
  // ── Ticket detail ────────────────────────────────────────────────
  cardNotFound: string;
  backHome: string;
  ratingExcellent: string;
  ratingVeryGood: string;
  ratingGood: string;
  ratingOkay: string;
  ratingBad: string;
  commentsLabel: string;
  noCommentsYet: string;
  beFirstToComment: string;
  addCommentPlaceholder: string;
  // Used by ChainsSection share & comments — kept here next to the other
  // comments/social keys so future translators see the cluster together.
  sendToFriend: string;
  searchShortPlaceholder: string;
  usersLabel: string;
  recentChatsLabel: string;
  userLabel: string;
  noUsersFoundShort: string;
  relativeTimeShort: (diffMs: number) => string;
  deleteCardTitle: string;
  deleteCardDesc: string;
  deleteCardBtn: string;
  // ── Create Ticket ────────────────────────────────────────────────
  stepSelectMovie: string;
  stepPostTicket: string;
  errNoRating: string;
  errDuplicateEpisode: string;
  errDuplicateGeneral: string;
  searchAnyLang: string;
  savedDraftsLabel: string;
  trendingNow: string;
  whatDidYouWatch: string;
  searchForMovieDesc: string;
  noMovieFoundTryAgain: string;
  tapToFlip: string;
  themeLabel: string;
  classicTheme: string;
  posterTheme: string;
  chooseCoverLabel: string;
  noBackdropFound: string;
  dragToAdjust: string;
  memoryLabel: string;
  memoryPlaceholder: string;
  noMemoryYet: string;
  privateMemory: string;
  privateMemoryHint: string;
  spoilerAlert: string;
  spoilerAlertDesc: string;
  spoiler: string;
  dyingStarLabel: string;
  report: string;
  reportReasons: string[];
  youPrefix: string;
  episodeLabel: string;
  episodeOptional: string;
  noEpisodeData: string;
  captionLabel: string;
  captionPlaceholder: string;
  detailsLabel: string;
  locationPlaceholder: string;
  partyLabel: string;
  partyDesc: string;
  partyTicketCount: string;
  yourTicketNum: string;
  inviteFriendsLabel: (n: number) => string;
  userSearchPlaceholder: string;
  privateCardLabel: string;
  postPartyTicketBtn: string;
  postTicketBtn: string;
  saveDraftTitle: string;
  saveDraftDesc: string;
  saveDraftBtn: string;
  discardBtn: string;
  continueBtn: string;
  // ── Create Chain ─────────────────────────────────────────────────
  chainAddedLabel: string;
  durationHour: string;
  durationDay: string;
  durationWeek: string;
  dragToSort: string;
  errChainNoTitle: string;
  errChainMinMovie: string;
  createChainTitle: string;
  addMovieLabel: string;
  chainNameLabel: string;
  chainNamePlaceholder: string;
  chainDescLabel: string;
  chainDescPlaceholder: string;
  errChainNameRequired: string;
  chainUntitled: string;
  moviesInChainLabel: string;
  sortDoneBtn: string;
  reorderBtn: string;
  closeBtn: string;
  noMoviesFound: string;
  noMoviesInChain: string;
  chainTimerDesc: string;
  communityAddDesc: string;
  huntModeLabel: string;
  huntModeDesc: string;
  huntChainBanner: string;
  huntFoundBadge: string;
  huntFoundTitle: (n: number) => string;
  huntFoundToggleOn: string;
  huntFoundToggleOff: string;
  detectiveTitle: string;
  detectiveKeyword: string;
  detectiveKeywordPlaceholder: string;
  detectiveGenre: string;
  detectiveDecade: string;
  detectiveLang: string;
  detectiveAny: string;
  detectiveFind: string;
  detectiveHint: string;
  creatingChain: string;
  unnamedDraft: string;
  saveDraftChainTitle: string;
  saveDraftChainDesc: string;
  savedDraftChainLabel: string;
  startOverBtn: string;
  backBtn: string;
  // ── Settings — badge (extra) ──────────────────────────────────────
  badgeCollectionTitle: string;
  badgeCollectionDesc: string;
  badgeCollectionDescPopcorn: string;
  evolvingBadge: string;
  evolveBtn: (name: string) => string;
  earnedBadge: string;
  // ── Supporter request page ────────────────────────────────────────
  supporterPageTitle: string;
  supporterPageSubtitle: string;
  pendingStatus: string;
  approvedStatus: string;
  rejectedStatus: string;
  pendingStatusDesc: string;
  approvedStatusDesc: string;
  rejectedStatusDesc: string;
  supporterBadgeDesc: string;
  supporterBenefits: string[];
  howToSupportTitle: string;
  paymentMethod: string;
  paymentAmount: string;
  scanQrToPay: string;
  attachSlipNote: string;
  uploadSlipTitle: string;
  tapToSelectSlip: string;
  changeSlip: string;
  sendingRequest: string;
  submitRequest: string;
  uploadSlipError: string;
  // ── Popcorn Bucket page-verification ──────────────────────────────
  popcornPageTitle: string;
  popcornPageSubtitle: string;
  popcornBadgeName: string;
  popcornBadgeDesc: string;
  popcornBenefits: string[];
  popcornHowToTitle: string;
  popcornStep1: string;
  popcornStep2: string;
  popcornStep3: string;
  popcornPageNameLabel: string;
  popcornPageNamePlaceholder: string;
  popcornPageUrlLabel: string;
  popcornPageUrlPlaceholder: string;
  popcornUploadProofTitle: string;
  popcornTapToSelectProof: string;
  popcornChangeProof: string;
  popcornPendingDesc: string;
  popcornApprovedDesc: string;
  popcornRejectedDesc: string;
  popcornSettingsLabel: string;
  popcornSettingsDesc: string;
  xpPosts: string;
  xpParty: string;
  howToEarnXP: string;
  xpPerPost: string;
  xpPerTag: string;
  xpPerParty: string;
  xpNeeded: (n: number) => string;
  xpNeededTotal: (n: number) => string;
  claimBadgeBtn: string;
  claimingBadge: string;
  collectXpDesc: string;
  pendingReview: string;
  pendingReviewDesc: string;
  supportThanks: string;
  // ── Settings — account dialogs ────────────────────────────────────
  makePublicTitle: string;
  makePrivateTitle: string;
  makePublicDesc: string;
  makePrivateDesc: string;
  savingChanges: string;
  logoutTitle: string;
  logoutConfirmDesc: string;
  loggingOut: string;
  deleteAccountLabel: string;
  deleteAccountLabelDesc: string;
  deleteAccountTitle: string;
  deleteAccountPermText: (word: string) => string;
  deleteAccountPlaceholder: string;
  deleteAccountConfirmWord: string;
  deletingAccountLabel: string;
  trashEmpty: string;
  trashEmptyDesc: string;
  trashSectionNote: string;
  settingsPageTitle: string;
  trashPageTitle: string;
  // ── Chain detail ─────────────────────────────────────────────────
  chainNotFound: string;
  cancelChainBtn: string;
  cancelingChain: string;
  loginToJoin: string;
  chainNowBtn: string;
  startingChain: string;
  shareMoviesYouLove: string;
  totalTimeLabel: string;
  chainingNow: (name: string) => string;
  movieListLabel: string;
  whyLikePlaceholder: string;
  addCommentChain: string;
  markWatched: string;
  savingWatched: string;
  addMovieToChain: string;
  chainFullMsg: string;
  addBtn: string;
  alreadyInChain: string;
  searchMovieChain: string;
  addedByLabel: string;
  saveBtn: string;
  // ── TicketCard feed ───────────────────────────────────────────────
  user: string;
  noCommentsBeFirst: string;
  signInToLike: string;
  timeJustNow: string;
  timeMin: string;
  timeHr: string;
  timeDay: string;
  confirmDeleteAgain: string;
  deletePost: string;
  moveToTrashTitle: string;
  moveToTrashDesc: string;
  confirmDeleteLabel: string;
  editPost: string;
  makePublic: string;
  setPrivate: string;
  showLikes: string;
  hideLikes: string;
  enableComments: string;
  disableComments: string;
  moveToTrash: string;
  reasonPlaceholder: string;
  reviewPlaceholder: string;
  watchLocationPlaceholder: string;
  collapse: string;
  readMore: string;
  // ── Report / Contact sheet ───────────────────────────────────────
  reportTicketTitle: string;
  reportUserTitle: string;
  reportCommentTitle: string;
  reportSelectReason: string;
  contactReplyPromise: string;
  reasonSpam: string;
  reasonInappropriate: string;
  reasonHarassment: string;
  reasonImpersonation: string;
  reasonOther: string;
  contactBug: string;
  contactFeature: string;
  contactAccount: string;
  contactContent: string;
  contactGeneral: string;
  nextBtn: string;
  sendBtn: string;
  emailOptionalLabel: string;
  detailsRequiredLabel: string;
  detailsOptionalLabel: string;
  describeIssuePlaceholder: string;
  tellUsMorePlaceholder: string;
  contactSentTitle: string;
  reportedTitle: string;
  contactSentDesc: string;
  reportedDesc: string;
  // ── Profile — edit sheet ─────────────────────────────────────────
  tapToChangeAvatar: string;
  displayNameLabel: string;
  displayNamePlaceholder: string;
  bioLabel: string;
  usernameLabel: string;
  bioPlaceholder: string;
  usernameChangeCooldown: string;
  usernameAvailableLabel: string;
  usernameTakenLabel: string;
  usernameFormatHint: string;
  errDisplayNameEmpty: string;
  errUsernameInvalid: string;
  errUsernameChangeFailed: string;
  errSaveFailed: string;
  errUploadAvatar: string;
  errGenericRetry: string;
  // ── Profile — chain subtabs ──────────────────────────────────────
  chainSubTabPlayed: string;
  chainSubTabCreated: string;
  noChainPlayedOwn: string;
  noChainPlayedOther: (name: string) => string;
  exploreChainsBtn: string;
  noChainCreatedOwn: string;
  noChainCreatedOther: (name: string) => string;
  createNewChainBtn: string;
  showChainCountLabel: string;
  hideChainCountLabel: string;
  privateAccountTitle: string;
  privateAccountDesc: string;
  // ── Movie detail ─────────────────────────────────────────────────
  trailerLabel: string;
  directorLabel: string;
  castLabel: string;
  watchOnLabel: string;
  seeMore: string;
  // ── Chains feed ──────────────────────────────────────────────────
  noChainsFeed: string;

  // BottomNav menu
  signupMenuTitle: string;
  signupMenuDesc: string;
  loginMenuTitle: string;
  loginMenuDesc: string;
  createTicketMenuDesc: string;
  createChainMenuDesc: string;
  // Edit pages
  editCardTitle: string;
  editChainTitle: string;
  // Create / edit ticket misc
  dateLabelPlaceholder: string;
  selectMovieAria: (name: string) => string;
  // Share Story modal
  errSaveCardFailed: string;
  savedSuccess: string;
  saveCardToStoryDesc: string;
  savedToDeviceTitle: string;
  openGalleryHint: string;
  saveCardSubdesc: string;
  iosLongPressHint: string;
  comingSoon: string;
  savingShort: string;
  sendInChatBtn: string;
  copiedLabel: string;
  copyLinkBtn: string;
}

const TH: Strings = {
  // Profile
  followers: "ผู้ติดตาม",
  followingLabel: "กำลังติดตาม",
  follow: "ติดตาม",
  followingBtn: "กำลังติดตาม",
  requested: "ส่งคำขอแล้ว",
  requestFollow: "ขอติดตาม",
  message: "ส่งข้อความ",
  editProfile: "แก้ไขโปรไฟล์",
  noFollowers: "ยังไม่มีผู้ติดตาม",
  noFollowing: "ยังไม่ได้ติดตามใคร",
  noMovieCards: "ยังไม่มีการ์ดหนัง",
  createCard: "+ สร้างการ์ด",
  // Movie detail — "Ticker Community" stays English (loanword)
  tickerCommunity: "Ticker Community",
  noOnePosted: "ยังไม่มีใครโพสต์การ์ดหนังเรื่องนี้",
  postedCards: "การ์ดที่โพสต์แล้ว",
  cardsUnit: "ใบ",
  dateLocale: "th-TH",
  datePlaceholder: "วันที่...",
  // Calendar
  calMonths: ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."],
  calDays: ["อา","จ","อ","พ","พฤ","ศ","ส"],
  // Settings — levels
  myLevel: "ระดับฉัน",
  levelStart: "เริ่ม",
  levelEarned: "ปลดล็อค",
  levelLocked: "ล็อค",
  maxLevel: "สูงสุด!",
  maxXp: "สูงสุด",
  nextLevel: (n) => `→ ระดับ ${n}`,
  // Settings — misc
  darkTheme: "ธีมสีเข้ม",
  darkThemeDesc: "สลับธีมสีเข้ม",
  privateProfile: "โปรไฟล์ส่วนตัว",
  privateProfileDesc: "เปิดแล้วผู้อื่นต้องส่งคำขอติดตามก่อน",
  trash: "ถังขยะ",
  trashDesc: "การ์ดที่ถูกลบ — กู้คืนได้ภายใน 30 วัน",
  pushNotifications: "การแจ้งเตือน",
  pushNotificationsDesc: "รับแจ้งเตือนเข้าเครื่องเมื่อมีกิจกรรมใหม่",
  pushBlockedTitle: "การแจ้งเตือนถูกบล็อก",
  pushBlockedAndroidPwa: "เปิดที่: Android Settings → แอป → Ticker → การแจ้งเตือน → อนุญาต แล้วกลับมากดปุ่มเปิดอีกครั้ง",
  pushBlockedDesktop: "เปิดที่ไอคอนรูปกุญแจหน้า URL → Site settings → Notifications → Allow แล้วรีเฟรชหน้านี้",
  pushPromptTitle: "เปิดการแจ้งเตือน",
  pushPromptBody: "รับแจ้งเตือนเมื่อมีคนตอบ ส่งข้อความ หรือมีหนังใหม่ที่น่าสนใจ คุณสามารถปิดได้ทุกเมื่อในหน้าตั้งค่า",
  pushPromptEnable: "เปิดการแจ้งเตือน",
  pushPromptLater: "ไว้ทีหลัง",
  adminPanel: "ผู้ดูแลระบบ",
  adminPanelDesc: "จัดการคำขอและส่งประกาศ",
  contactTicker: "ติดต่อ Ticker",
  contactTickerDesc: "แจ้งปัญหา ข้อเสนอแนะ หรือสอบถาม",
  supportTicker: "สนับสนุน Ticker",
  supportTickerDesc: "สนับสนุน เข้าร่วม Community ของเรา",
  logout: "ออกจากระบบ",
  logoutDesc: "ออกจากบัญชีนี้บนอุปกรณ์เครื่องนี้",
  // Settings — language
  language: "ภาษา",
  langTh: "ไทย",
  langEn: "English",
  // Settings — trash
  deletePermanentlyIn: (days) => `ลบถาวรใน ${days} วัน`,
  willDeleteSoon: "จะถูกลบถาวรเร็วๆ นี้",
  restore: "กู้คืน",
  purge: "ลบถาวร",
  moviesCount: (n) => `${n} เรื่อง`,
  chainTimes: "ครั้ง",
  movieCount: "เรื่อง",
  episodeRatings: "คะแนนรายตอน",
  purgeTitle: "ลบถาวร",
  purgeDesc: "ไม่สามารถกู้คืนได้หลังจากลบ",
  purgeCannotRecover: "รายการที่ลบแล้วจะถูกเก็บไว้ที่นี่ 30 วัน หลังจากนั้นจะถูกลบถาวรโดยอัตโนมัติ",
  // Settings — badge (extra)
  badgeCollectionTitle: "Badge Collection",
  evolvingBadge: "กำลัง Evolve...",
  evolveBtn: (name) => `Evolve → ${name}`,
  earnedBadge: "ได้รับแล้ว",
  // Supporter page
  supporterPageTitle: "สนับสนุน Ticker",
  supporterPageSubtitle: "รับ Supporter Badge Lv5",
  pendingStatus: "รอการตรวจสอบ",
  approvedStatus: "อนุมัติแล้ว! คุณเป็น Supporter",
  rejectedStatus: "ไม่ผ่านการตรวจสอบ",
  pendingStatusDesc: "ส่งสลิปแล้ว กำลังรอผู้ดูแลระบบตรวจสอบ",
  approvedStatusDesc: "Supporter Badge Lv5 ถูก Unlock แล้ว ไปที่ Settings > Badge ได้เลย",
  rejectedStatusDesc: "กรุณาติดต่อผู้ดูแลระบบเพื่อสอบถามเพิ่มเติม",
  supporterBadgeDesc: "Badge พิเศษสำหรับผู้สนับสนุน Ticker",
  supporterBenefits: [
    "Supporter Badge Lv5 สีรุ้ง แสดงในโปรไฟล์",
    "ไม่กระทบ Badge Lv1-4 ที่มีอยู่",
    "สนับสนุนการพัฒนา Ticker ต่อไป",
  ],
  howToSupportTitle: "วิธีสนับสนุน",
  paymentMethod: "ช่องทาง",
  paymentAmount: "จำนวน",
  scanQrToPay: "สแกน QR เพื่อชำระเงิน",
  attachSlipNote: "แนบสลิปเป็นหลักฐาน",
  uploadSlipTitle: "อัพโหลดสลิป",
  tapToSelectSlip: "แตะเพื่อเลือกรูปสลิป",
  changeSlip: "เลือกรูปใหม่",
  sendingRequest: "กำลังส่ง...",
  submitRequest: "ส่งคำขอ",
  uploadSlipError: "อัพโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง",
  // Popcorn Bucket
  popcornPageTitle: "ขอ Badge ถังป็อปคอร์น",
  popcornPageSubtitle: "ยืนยันตัวตนเป็นเจ้าของเพจหนัง",
  popcornBadgeName: "เพจ/ครีเอเตอร์",
  popcornBadgeDesc: "ผู้ผลิตคอนเทนต์",
  popcornBenefits: [
    "แสดงสัญลักษณ์ถังป็อปคอร์นข้างชื่อ ยืนยันว่าเป็นเพจจริง",
    "ไม่นับเป็น Lv ไม่กระทบ Badge ที่มี",
    "เพิ่มความน่าเชื่อถือให้กับเพจของคุณ",
  ],
  popcornHowToTitle: "ขั้นตอนการยืนยัน",
  popcornStep1: "ระบุชื่อเพจและลิงก์ (Facebook / IG / TikTok ฯลฯ)",
  popcornStep2: "แนบภาพหลักฐานความเป็นเจ้าของเพจ (เช่น สกรีนช็อตหน้า admin)",
  popcornStep3: "รอผู้ดูแลระบบตรวจสอบ — เมื่ออนุมัติแล้วจะได้ Badge ทันที",
  popcornPageNameLabel: "ชื่อเพจหนัง",
  popcornPageNamePlaceholder: "เช่น Movie Review TH",
  popcornPageUrlLabel: "ลิงก์เพจ (ถ้ามี)",
  popcornPageUrlPlaceholder: "https://facebook.com/...",
  popcornUploadProofTitle: "ภาพหลักฐาน",
  popcornTapToSelectProof: "แตะเพื่อเลือกภาพหลักฐาน",
  popcornChangeProof: "เลือกภาพใหม่",
  popcornPendingDesc: "ส่งคำขอแล้ว กำลังรอการตรวจสอบ",
  popcornApprovedDesc: "คุณได้รับการยืนยันอย่างเป็นทางการ",
  popcornRejectedDesc: "หลักฐานไม่ผ่าน กรุณาส่งใหม่หรือติดต่อผู้ดูแลระบบ",
  popcornSettingsLabel: "ยืนยันตัวตน",
  popcornSettingsDesc: "ยืนยันตัวตนเพจหนังของคุณ",
  // Settings — badge
  noBadgeYet: "ยังไม่มี Badge",
  badgeNames: {
    1: { name: "คนดูหนัง", desc: "ก้าวแรกสู่โลกหนัง" },
    2: { name: "แฟนหนัง", desc: "ติดตามหนังไม่พลาด" },
    3: { name: "ซีเนฟิล", desc: "หลงรักศิลปะภาพยนตร์" },
    4: { name: "นักวิจารณ์", desc: "เสียงที่เชื่อถือได้" },
    5: { name: "ผู้สนับสนุน", desc: "สำหรับผู้สนับสนุน Ticker" },
  },
  // Chat
  chatTitle: "ข้อความ",
  searchNamePlaceholder: "ค้นหาชื่อ...",
  noChats: "ยังไม่มีแชท",
  noChatsDesc: "กดปุ่มบน Profile ของใครก็ได้เพื่อเริ่มแชท",
  manageChat: "จัดการแชท",
  leaveConv: "ออกจากการสนทนา",
  leaveConvTitle: "ออกจากการสนทนา?",
  leaveConvDesc: "แชทนี้จะหายไปจากรายการของคุณ",
  cancelBtn: "ยกเลิก",
  confirmBtn: "ยืนยัน",
  deletingLabel: "กำลังลบ...",
  noMessages: "ยังไม่มีข้อความ",
  imageMsg: "รูปภาพ",
  messageRequestsLabel: (n) => `คำขอข้อความ (${n})`,
  messagesLabel: "ข้อความ",
  // Chat conversation
  deletedCard: "การ์ดหนัง (ถูกลบแล้ว)",
  deletedMsg: "ถูกลบแล้ว",
  deleteMessageTitle: "ลบข้อความนี้?",
  deleteMessageDesc: "ข้อความจะหายไปสำหรับทุกคน",
  messageOptions: "จัดการข้อความ",
  copyMessage: "คัดลอกข้อความ",
  deleteMessage: "ลบข้อความ",
  uploadImageError: "ส่งรูปไม่สำเร็จ กรุณาลองใหม่",
  imageLoadError: "ไม่สามารถโหลดรูปได้",
  typePlaceholder: "พิมพ์ข้อความ...",
  messageRequestFrom: (name) => `${name} ต้องการส่งข้อความหาคุณ`,
  // Notifications
  notifTitle: "แจ้งเตือน",
  searchNotifsPlaceholder: "ค้นหาการแจ้งเตือน...",
  noNotifs: "ไม่มีการแจ้งเตือน",
  noNotifsDesc: "การแจ้งเตือนใหม่จะปรากฏที่นี่",
  acceptBtn: "ยอมรับ",
  declineBtn: "ปฏิเสธ",
  acceptedLabel: "ยอมรับแล้ว",
  declinedLabel: "ปฏิเสธแล้ว",
  approveBtn: "อนุมัติ",
  denyBtn: "ปฏิเสธ",
  respondedLabel: "ตอบรับแล้ว",
  // Party invite
  partyInviteFrom: "คำเชิญปาร์ตี้จาก",
  partySizeLabel: (n) => `ปาร์ตี้ ${n} คน`,
  chooseSeat: "เลือกที่นั่งของคุณ",
  seatTakenHint: "สีเทา = ถูกเลือกไปแล้ว",
  yourRating: "คะแนนของคุณ",
  alreadyAccepted: "ยอมรับแล้ว",
  errSeatTaken: "เลขที่นั่งนี้ถูกเลือกไปแล้ว กรุณาเลือกใหม่",
  errDuplicateMovie: "คุณโพสต์หนังเรื่องนี้ไปแล้ว",
  errGeneric: "เกิดข้อผิดพลาด กรุณาลองใหม่",
  errChooseSeat: "กรุณาเลือกที่นั่ง",
  errGiveRating: "กรุณาให้คะแนน",
  expiredLabel: "หมดอายุ",
  partyExpiredTitle: "คำเชิญหมดอายุ",
  partyExpiredDesc: "เจ้าของโพสต์ปาร์ตี้ลบการ์ดต้นฉบับไปแล้ว คำเชิญนี้จึงหมดอายุและไม่สามารถตอบรับได้",
  // Home
  noTicketsFeed: "ยังไม่มีโพสต์ Tickets",
  noUserFound: "ไม่พบผู้ใช้ที่ค้นหา",
  noUserFoundDesc: "ลองค้นหาด้วยชื่ออื่น",
  searchUsersPlaceholder: "ค้นหาผู้ใช้...",
  // Search — section titles always English (loanwords), descriptions follow language
  searchMoviePlaceholder: "ค้นหาหนัง ซีรีส์...",
  noSearchResults: "ไม่พบผลการค้นหา",
  emptySection: "ไม่พบรายการในขณะนี้",
  sections: {
    trending:          { title: "Trending",           desc: "ดูเถอะ จะได้คุยกับชาวบ้านเขารู้เรื่อง" },
    now_playing:       { title: "Now Playing",         desc: "กำเงินไปโรงหนังเดี๋ยวนี้เลย!" },
    legendary:         { title: "LEGENDARY",           desc: "ดูแล้วเข้าใจว่าทำไมคนยังพูดถึง" },
    cult_classic:      { title: "CULT CLASSIC",        desc: "พล็อตล้ำจนต้องร้อง ห้ะ?" },
    "2am_deep_talk":   { title: "2 AM Deep Talk",      desc: "ตีสองแล้วยังไม่นอน มาหาเรื่องให้คิดจนเช้ากัน" },
    brain_rot:         { title: "Brain Rot",           desc: "ปล่อยสมองไหลไปกับหนัง พลังงานเหลือล้น" },
    main_character:    { title: "Main Character",      desc: "ดูจบแล้วรู้สึกเหมือนเป็นพระเอก... จนกว่าจะส่องกระจก" },
    heartbreak:        { title: "Heartbreak Romance",  desc: "เจ็บแล้วไม่จำ เดี๋ยวพี่ซ้ำให้เอง" },
    chaos_red_flags:   { title: "Chaos & Red Flags",   desc: "ประสาทกินอย่างมีสไตล์ ใครชอบแนวนี้คือพวกเดียวกัน" },
    anime:             { title: "Anime",               desc: "เข้าแล้วออกยาก วงการนี้ไม่มีคำว่าพัก" },
    tokusatsu:         { title: "Tokusatsu",           desc: "ระเบิดทุกตอน ไม่มีข้ออ้าง" },
    disney_dreamworks: { title: "Disney & DreamWorks", desc: "ใจฟูเบอร์แรง ดูแล้วเหมือนได้ชาร์จแบต" },
    k_wave:            { title: "K-Wave",              desc: "เตรียมรามยอนให้พร้อม แล้วไปโอปป้ากัน" },
    midnight_horror:   { title: "Midnight Horror",     desc: "ไม่ได้น่ากลัวอย่างที่คิด... แต่นอนเปิดไฟด้วยก็ดี" },
    marvel_dc:         { title: "Marvel & DC",         desc: "ดูทุกภาค หรือไม่ต้องก็ยังได้" },
  },
  // Following feed
  noPostsYet: "ยังไม่มีโพสต์",
  noPostsYetDesc: "ยังไม่มีโพสต์ในระบบตอนนี้",
  // Bookmarks
  bookmarksTitle: "บันทึก",
  tabAll: "ทั้งหมด",
  noBookmarks: "ยังไม่มีรายการที่บันทึก",
  noBookmarksDesc: "บันทึกตั๋ว หนัง และ Chains ที่อยากดูไว้ที่นี่",
  noMovieBookmarks: "ยังไม่มีหนังที่บันทึก",
  noMovieBookmarksDesc: "กดบันทึกหนังที่อยากดูไว้ที่นี่",
  noTicketBookmarks: "ยังไม่มีตั๋วที่บันทึก",
  noTicketBookmarksDesc: "บันทึกตั๋วหนังที่ชอบไว้ที่นี่",
  noChainBookmarks: "ยังไม่มี Chains ที่บันทึก",
  noChainBookmarksDesc: "กดบันทึก Chains ที่ชอบไว้ที่นี่",
  // Ticket detail
  cardNotFound: "ไม่พบการ์ดนี้",
  backHome: "กลับหน้าหลัก",
  ratingExcellent: "ยอดเยี่ยม",
  ratingVeryGood: "ดีมาก",
  ratingGood: "ดี",
  ratingOkay: "พอใช้",
  ratingBad: "แย่",
  commentsLabel: "ความคิดเห็น",
  noCommentsYet: "ยังไม่มีความคิดเห็น",
  beFirstToComment: "เป็นคนแรกที่แสดงความคิดเห็น",
  addCommentPlaceholder: "เพิ่มความคิดเห็น...",
  sendToFriend: "ส่งให้เพื่อน",
  searchShortPlaceholder: "ค้นหา...",
  usersLabel: "ผู้ใช้",
  recentChatsLabel: "แชทล่าสุด",
  userLabel: "ผู้ใช้",
  noUsersFoundShort: "ไม่พบผู้ใช้",
  relativeTimeShort: (diffMs) => {
    const mins  = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days  = Math.floor(diffMs / 86400000);
    if (mins < 1) return "เมื่อกี้";
    if (mins < 60) return `${mins} น.`;
    if (hours < 24) return `${hours} ชม.`;
    return `${days} ว.`;
  },
  deleteCardTitle: "ลบการ์ดนี้",
  deleteCardDesc: "การ์ดนี้จะถูกลบถาวรและไม่สามารถกู้คืนได้",
  deleteCardBtn: "ลบการ์ด",
  // Create Ticket
  stepSelectMovie: "เลือกหนัง",
  stepPostTicket: "กดตั๋ว",
  errNoRating: "กรุณาให้คะแนนก่อนกดตั๋ว",
  errDuplicateEpisode: "คุณโพสต์ตอนนี้ไปแล้ว ลองเลือกตอนอื่นแทน",
  errDuplicateGeneral: "คุณโพสต์ดูทั่วไปของซีรีส์นี้ไปแล้ว ลองเลือกตอนเพื่อโพสต์ใหม่",
  searchAnyLang: "ค้นหาชื่อหนังด้วยภาษาไหนก็ได้...",
  savedDraftsLabel: "ดราฟที่บันทึกไว้",
  trendingNow: "ยอดนิยมตอนนี้",
  whatDidYouWatch: "ดูหนังอะไรมา?",
  searchForMovieDesc: "ค้นหาชื่อหนังเพื่อสร้างการ์ดความทรงจำ",
  noMovieFoundTryAgain: "ไม่พบหนัง ลองพิมพ์ใหม่",
  tapToFlip: "แตะการ์ดเพื่อพลิก",
  themeLabel: "ธีม",
  classicTheme: "คลาสสิก",
  posterTheme: "โปสเตอร์",
  chooseCoverLabel: "เลือกภาพปก (สแกนฉาก)",
  noBackdropFound: "ไม่พบ backdrop สำหรับหนังเรื่องนี้",
  dragToAdjust: "ลากภาพ preview เพื่อปรับตำแหน่ง",
  memoryLabel: "ความทรงจำ",
  memoryPlaceholder: "ประโยคสั้นๆ ถึงความทรงจำ...",
  noMemoryYet: "ยังไม่มีความทรงจำ",
  privateMemory: "ความทรงจำส่วนตัว",
  privateMemoryHint: "ความทรงจำส่วนตัว — แตะเพื่อขอดู",
  spoilerAlert: "เตือนสปอยล์",
  spoilerAlertDesc: "โพสต์นี้มีการสปอยล์เนื้อหา",
  spoiler: "สปอยล์",
  dyingStarLabel: "ดาวเน่า",
  report: "รายงาน",
  reportReasons: ["สแปม", "ไม่เหมาะสม", "การคุกคาม", "สปอยล์โดยไม่เตือน", "อื่นๆ"],
  youPrefix: "คุณ: ",
  episodeLabel: "เลือกตอน",
  episodeOptional: "เลือกตอน (ไม่บังคับ)",
  noEpisodeData: "ไม่พบข้อมูลตอน",
  captionLabel: "แคปชั่น",
  captionPlaceholder: "บอกเพื่อนว่าหนังเรื่องนี้ยังไง...",
  detailsLabel: "รายละเอียด",
  locationPlaceholder: "สถานที่...",
  partyLabel: "ปาร์ตี้",
  partyDesc: "ดูด้วยกันหลายคน",
  partyTicketCount: "คุณจะกดกี่ใบ?",
  yourTicketNum: "ของคุณใบที่เท่าไหร่?",
  inviteFriendsLabel: (n) => `เชิญเพื่อน (${n})`,
  userSearchPlaceholder: "ค้นหาผู้ใช้...",
  privateCardLabel: "การ์ดส่วนตัว",
  postPartyTicketBtn: "กดตั๋วปาร์ตี้",
  postTicketBtn: "กดตั๋ว",
  saveDraftTitle: "บันทึกดราฟ?",
  saveDraftDesc: "คุณยังเขียนตั๋วไม่เสร็จ อยากบันทึกไว้เพื่อเขียนต่อในภายหลังไหม?",
  saveDraftBtn: "บันทึกดราฟ",
  discardBtn: "ทิ้งเลย",
  continueBtn: "เขียนต่อ",
  // Create Chain
  chainAddedLabel: "เพิ่มแล้ว",
  durationHour: "ชั่วโมง",
  durationDay: "วัน",
  durationWeek: "สัปดาห์",
  dragToSort: "ลากเพื่อเรียง",
  errChainNoTitle: "กรุณาใส่ชื่อ Chain",
  errChainMinMovie: "เพิ่มหนังอย่างน้อย 1 เรื่อง",
  createChainTitle: "สร้าง Chain",
  addMovieLabel: "เพิ่มหนัง",
  chainNameLabel: "ชื่อ",
  chainNamePlaceholder: "ชื่อ Chain ของคุณ...",
  chainDescLabel: "คำอธิบาย",
  chainDescPlaceholder: "อธิบาย Chain ของคุณ... (ไม่บังคับ)",
  errChainNameRequired: "กรุณาใส่ชื่อ Chain",
  chainUntitled: "ไม่มีชื่อ",
  moviesInChainLabel: "หนังใน Chain",
  sortDoneBtn: "เสร็จแล้ว",
  reorderBtn: "เรียงลำดับ",
  closeBtn: "ปิด",
  noMoviesFound: "ไม่พบหนัง",
  noMoviesInChain: "ยังไม่มีหนัง — กด เพิ่มหนัง",
  chainTimerDesc: "กำหนดเวลาให้ Chain ต่อ",
  communityAddDesc: "ให้คนอื่นเพิ่มหนังเข้าลิสต์ได้",
  huntModeLabel: "Hunt",
  huntModeDesc: "ให้ชุมชนช่วยตามหาหนัง — ไม่ต้องใส่หนังเริ่มต้น",
  huntChainBanner: "ช่วยกันหา! เพิ่มหนังที่คุณคิดว่าตรงกับโพสต์นี้",
  huntFoundBadge: "เจอแล้ว",
  huntFoundTitle: (n: number) => `เจอแล้ว ${n} เรื่อง`,
  huntFoundToggleOn: "ทำเครื่องหมายว่าเจอแล้ว",
  huntFoundToggleOff: "ยกเลิกว่าเจอแล้ว",
  detectiveTitle: "Movie Detective",
  detectiveKeyword: "คีย์เวิร์ด",
  detectiveKeywordPlaceholder: "ชื่อหนัง หรือ ชื่อนักแสดง/ผู้กำกับ...",
  detectiveGenre: "แนว",
  detectiveDecade: "ยุค",
  detectiveLang: "ภาษา",
  detectiveAny: "ทั้งหมด",
  detectiveFind: "ค้นหาหนัง",
  detectiveHint: "พิมพ์คีย์เวิร์ด หรือเลือกตัวกรอง แล้วกด ค้นหาหนัง",
  creatingChain: "กำลังสร้าง...",
  unnamedDraft: "ไม่มีชื่อ",
  saveDraftChainTitle: "บันทึกดราฟ?",
  saveDraftChainDesc: "คุณยังสร้าง Chain ไม่เสร็จ อยากบันทึกไว้เพื่อเขียนต่อในภายหลังไหม?",
  savedDraftChainLabel: "ดราฟที่บันทึกไว้",
  startOverBtn: "เริ่มใหม่",
  backBtn: "ย้อนกลับ",
  // Settings — badge (extra)
  badgeCollectionDesc: "สะสม XP เพื่ออัพระดับ Badge",
  badgeCollectionDescPopcorn: "ยืนยันตัวตนเพจ/ครีเอเตอร์ของคุณ",
  xpPosts: "โพสต์",
  xpParty: "ปาร์ตี้",
  howToEarnXP: "วิธีรับ XP",
  xpPerPost: "+5 XP / ครั้ง",
  xpPerTag: "+3 XP / คน",
  xpPerParty: "+10 XP / ครั้ง",
  xpNeeded: (n) => `ต้องการ ${n} XP`,
  xpNeededTotal: (n) => `ต้องการ ${n} XP รวม`,
  claimBadgeBtn: "รับ Badge แรก!",
  claimingBadge: "กำลังรับ...",
  collectXpDesc: "สะสม XP จากโพสต์ · tag เพื่อน · ปาร์ตี้",
  pendingReview: "⏳ รอการตรวจสอบ",
  pendingReviewDesc: "ส่งสลิปแล้ว กำลังรอผู้ดูแลตรวจสอบ",
  supportThanks: "ขอบคุณที่สนับสนุน Ticker ♥",
  // Settings — account dialogs
  makePublicTitle: "เปิดโปรไฟล์สาธารณะ",
  makePrivateTitle: "ปิดเป็นบัญชีส่วนตัว",
  makePublicDesc: "ทุกคนจะสามารถเข้าดูโปรไฟล์ของคุณได้",
  makePrivateDesc: "เฉพาะผู้คนที่คุณอนุมัติเท่านั้นที่สามารถเข้าดูโปรไฟล์ของคุณได้",
  savingChanges: "กำลังบันทึก...",
  logoutTitle: "ออกจากระบบ",
  logoutConfirmDesc: "คุณต้องการออกจากระบบใช่ไหม?",
  loggingOut: "กำลังออก...",
  deleteAccountLabel: "ลบบัญชี",
  deleteAccountLabelDesc: "ลบบัญชีและข้อมูลทั้งหมดถาวร",
  deleteAccountTitle: "ลบบัญชีถาวร",
  deleteAccountPermText: (word) => `บัญชีและข้อมูลทั้งหมดของคุณจะถูกลบถาวร พิมพ์ ${word} เพื่อยืนยัน`,
  deleteAccountPlaceholder: "พิมพ์ 'ลบบัญชี' เพื่อยืนยัน",
  deleteAccountConfirmWord: "ลบบัญชี",
  deletingAccountLabel: "กำลังลบ...",
  trashEmpty: "ถังขยะว่างเปล่า",
  trashEmptyDesc: "Tickets และ Chains ที่คุณลบจะปรากฏที่นี่",
  trashSectionNote: "รายการที่ลบแล้วจะถูกเก็บไว้ที่นี่ 30 วัน หลังจากนั้นจะถูกลบถาวรโดยอัตโนมัติ",
  settingsPageTitle: "ตั้งค่า",
  trashPageTitle: "ถังขยะ",
  // Chain detail
  chainNotFound: "ไม่พบ Chain นี้",
  cancelChainBtn: "ยกเลิก Chain",
  cancelingChain: "กำลังยกเลิก...",
  loginToJoin: "กด + เพื่อเข้าสู่ระบบหรือสมัครสมาชิก",
  chainNowBtn: "Chain เลย",
  startingChain: "กำลังเริ่ม...",
  shareMoviesYouLove: "ร่วมกันแชร์หนังที่คุณรัก",
  totalTimeLabel: "เวลารวม",
  chainingNow: (name) => `${name} กำลัง Chain อยู่`,
  movieListLabel: "รายการ",
  whyLikePlaceholder: "บอกเหตุผลที่ชอบหนังนี้... (ไม่บังคับ)",
  addCommentChain: "เพิ่มความคิดเห็น...",
  markWatched: "ดูจบแล้ว",
  savingWatched: "กำลังบันทึก...",
  addMovieToChain: "เพิ่มหนังลงใน Chain",
  chainFullMsg: "Chain นี้มีหนังครบแล้ว",
  addBtn: "เพิ่ม",
  alreadyInChain: "มีแล้ว",
  searchMovieChain: "ค้นหาชื่อหนัง...",
  addedByLabel: "เพิ่มโดย @",
  saveBtn: "บันทึก",
  // ── TicketCard feed ───────────────────────────────────────────────
  user: "ผู้ใช้",
  noCommentsBeFirst: "ยังไม่มีคอมเมนต์ — เป็นคนแรก!",
  signInToLike: "กด + เพื่อเข้าสู่ระบบหรือสมัครสมาชิก",
  timeJustNow: "เมื่อกี้",
  timeMin: "น.",
  timeHr: "ชม.",
  timeDay: "ว.",
  confirmDeleteAgain: "กดอีกครั้งเพื่อยืนยันลบ",
  deletePost: "ลบโพสต์",
  moveToTrashTitle: "ย้ายไปถังขยะ?",
  moveToTrashDesc: "กู้คืนได้ภายใน 30 วัน",
  confirmDeleteLabel: "ยืนยัน ลบ",
  editPost: "แก้ไขโพสต์",
  makePublic: "เปิดสาธารณะ",
  setPrivate: "ตั้งเป็น Private",
  showLikes: "เปิดแสดงจำนวนไลค์",
  hideLikes: "ซ่อนจำนวนไลค์",
  enableComments: "เปิดคอมเมนต์",
  disableComments: "ปิดคอมเมนต์",
  moveToTrash: "ย้ายไปถังขยะ",
  reasonPlaceholder: "บอกเหตุผลที่ชอบหนังนี้... (ไม่บังคับ)",
  reviewPlaceholder: "บอกเพื่อนว่าหนังเรื่องนี้ยังไง...",
  watchLocationPlaceholder: "สถานที่...",
  collapse: "ย่อ",
  readMore: "อ่านเพิ่มเติม",
  // Report / Contact sheet
  reportTicketTitle: "รายงาน Ticket",
  reportUserTitle: "รายงาน User",
  reportCommentTitle: "รายงาน Comment",
  reportSelectReason: "เลือกเหตุผลในการรายงาน",
  contactReplyPromise: "เราจะตอบกลับโดยเร็วที่สุด",
  reasonSpam: "สแปม / โฆษณา",
  reasonInappropriate: "เนื้อหาไม่เหมาะสม",
  reasonHarassment: "การคุกคาม / ล่วงละเมิด",
  reasonImpersonation: "แอบอ้างตัวตน",
  reasonOther: "อื่นๆ",
  contactBug: "พบบั๊กหรือปัญหาการใช้งาน",
  contactFeature: "ขอฟีเจอร์ใหม่",
  contactAccount: "ปัญหาเกี่ยวกับบัญชี",
  contactContent: "ปัญหาเนื้อหา / รายงาน",
  contactGeneral: "สอบถามทั่วไป",
  nextBtn: "ต่อไป",
  sendBtn: "ส่ง",
  emailOptionalLabel: "อีเมล (ไม่บังคับ)",
  detailsRequiredLabel: "รายละเอียด *",
  detailsOptionalLabel: "รายละเอียดเพิ่มเติม (ไม่บังคับ)",
  describeIssuePlaceholder: "อธิบายปัญหาหรือคำถามของคุณ...",
  tellUsMorePlaceholder: "บอกเพิ่มเติมเกี่ยวกับปัญหา...",
  contactSentTitle: "ส่งข้อความแล้ว!",
  reportedTitle: "รายงานแล้ว!",
  contactSentDesc: "ทีม Ticker ได้รับข้อความของคุณแล้ว เราจะตรวจสอบและตอบกลับโดยเร็วที่สุด",
  reportedDesc: "ทีมงานจะตรวจสอบรายงานของคุณ ขอบคุณที่ช่วยให้ Ticker ปลอดภัย",
  // Profile — edit sheet
  tapToChangeAvatar: "แตะเพื่อเปลี่ยนรูปโปรไฟล์",
  displayNameLabel: "ชื่อแสดง",
  displayNamePlaceholder: "ชื่อของคุณ",
  bioLabel: "แนะนำตัว",
  usernameLabel: "ชื่อผู้ใช้",
  bioPlaceholder: "แนะนำตัวเองสักนิด...",
  usernameChangeCooldown: "เปลี่ยนได้ทุก 7 วัน",
  usernameAvailableLabel: "ชื่อผู้ใช้นี้ว่างอยู่",
  usernameTakenLabel: "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว",
  usernameFormatHint: "ตัวอักษร a-z, 0-9, _ ความยาว 3-30 ตัว",
  errDisplayNameEmpty: "ชื่อแสดงห้ามว่าง",
  errUsernameInvalid: "ชื่อผู้ใช้ไม่ถูกต้อง",
  errUsernameChangeFailed: "เปลี่ยนชื่อผู้ใช้ไม่สำเร็จ",
  errSaveFailed: "บันทึกไม่สำเร็จ กรุณาลองใหม่",
  errUploadAvatar: "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่",
  errGenericRetry: "เกิดข้อผิดพลาด กรุณาลองใหม่",
  // Profile — chain subtabs
  chainSubTabPlayed: "เล่นแล้ว",
  chainSubTabCreated: "สร้างไว้",
  noChainPlayedOwn: "ยังไม่ได้เล่น Chain ไหนเลย",
  noChainPlayedOther: (name) => `${name} ยังไม่ได้เล่น Chain`,
  exploreChainsBtn: "ไปดู Chain",
  noChainCreatedOwn: "ยังไม่ได้สร้าง Chain ไหนเลย",
  noChainCreatedOther: (name) => `${name} ยังไม่ได้สร้าง Chain`,
  createNewChainBtn: "+ สร้าง Chain ใหม่",
  showChainCountLabel: "แสดงจำนวน Chains",
  hideChainCountLabel: "ซ่อนจำนวน Chains",
  privateAccountTitle: "บัญชีส่วนตัว",
  privateAccountDesc: "ติดตามบัญชีนี้เพื่อดูภาพยนตร์ทั้งหมด",
  // Movie detail
  trailerLabel: "ตัวอย่างหนัง",
  directorLabel: "กำกับ",
  castLabel: "นักแสดง",
  watchOnLabel: "ดูได้ที่",
  seeMore: "... ดูเพิ่มเติม",
  // Chains feed
  noChainsFeed: "ยังไม่มีโพสต์ Chains",

  // BottomNav menu
  signupMenuTitle: "สมัครสมาชิก",
  signupMenuDesc: "สร้างบัญชีและเริ่มบันทึกหนัง",
  loginMenuTitle: "เข้าสู่ระบบ",
  loginMenuDesc: "กลับเข้าสู่บัญชีของคุณ",
  createTicketMenuDesc: "บันทึกความทรงจำหนังของคุณ",
  createChainMenuDesc: "คิวเรตหนังให้คนอื่น chain ต่อ",
  // Edit pages
  editCardTitle: "แก้ไขการ์ด",
  editChainTitle: "แก้ไข Chain",
  // Create / edit ticket misc
  dateLabelPlaceholder: "วันที่...",
  selectMovieAria: (name) => `เลือก ${name}`,
  // Share Story modal
  errSaveCardFailed: "บันทึกไม่สำเร็จ กรุณาลองใหม่",
  savedSuccess: "บันทึกสำเร็จ",
  saveCardToStoryDesc: "บันทึกการ์ดลงเครื่องเพื่อแชร์ลงสตอรี่",
  savedToDeviceTitle: "บันทึกรูปลงเครื่องแล้ว",
  openGalleryHint: "เปิดแอปคลังรูป แล้วลงสตอรี่ได้เลย",
  saveCardSubdesc: "แอปจะบันทึกการ์ดหน้า + หลัง ลงในเครื่องของคุณ",
  iosLongPressHint: "กดค้างที่รูปด้านบน แล้วเลือก “เพิ่มในรูปภาพ” เพื่อบันทึกลงเครื่อง",
  comingSoon: "เร็วๆนี้",
  savingShort: "กำลังบันทึก",
  sendInChatBtn: "ส่งในแชท",
  copiedLabel: "คัดลอกแล้ว",
  copyLinkBtn: "คัดลอกลิงก์",
};

const EN: Strings = {
  // Profile
  followers: "Followers",
  followingLabel: "Following",
  follow: "Follow",
  followingBtn: "Following",
  requested: "Requested",
  requestFollow: "Request Follow",
  message: "Message",
  editProfile: "Edit Profile",
  noFollowers: "No followers yet",
  noFollowing: "Not following anyone",
  noMovieCards: "No movie cards yet",
  createCard: "+ Create Card",
  // Movie detail
  tickerCommunity: "Ticker Community",
  noOnePosted: "No one has posted a card for this movie yet",
  postedCards: "Posted Cards",
  cardsUnit: "cards",
  dateLocale: "en-US",
  datePlaceholder: "Date...",
  // Calendar
  calMonths: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
  calDays: ["Su","Mo","Tu","We","Th","Fr","Sa"],
  // Settings — levels
  myLevel: "MY LEVEL",
  levelStart: "START",
  levelEarned: "EARNED",
  levelLocked: "LOCKED",
  maxLevel: "MAX LEVEL!",
  maxXp: "MAX",
  nextLevel: (n) => `→ Lv ${n}`,
  // Settings — misc
  darkTheme: "Dark Theme",
  darkThemeDesc: "Switch to dark theme",
  privateProfile: "Private Profile",
  privateProfileDesc: "Others must request to follow you",
  trash: "Trash",
  trashDesc: "Deleted cards — recoverable within 30 days",
  pushNotifications: "Push Notifications",
  pushNotificationsDesc: "Get device alerts for new activity",
  pushBlockedTitle: "Notifications are blocked",
  pushBlockedAndroidPwa: "Open: Android Settings → Apps → Ticker → Notifications → Allow, then come back and tap the toggle again",
  pushBlockedDesktop: "Click the lock icon in the address bar → Site settings → Notifications → Allow, then refresh this page",
  pushPromptTitle: "Turn on notifications",
  pushPromptBody: "Get alerts when someone replies, messages you, or when there's a new movie worth watching. You can turn this off anytime in Settings.",
  pushPromptEnable: "Enable notifications",
  pushPromptLater: "Maybe later",
  adminPanel: "Admin Panel",
  adminPanelDesc: "Manage requests and send announcements",
  contactTicker: "Contact Ticker",
  contactTickerDesc: "Report a problem, suggest a feature, or ask us anything",
  supportTicker: "Support Ticker",
  supportTickerDesc: "Support us and join our community",
  logout: "Log Out",
  logoutDesc: "Sign out of this account on this device",
  // Settings — language
  language: "Language",
  langTh: "Thai",
  langEn: "English",
  // Settings — trash
  deletePermanentlyIn: (days) => `Deletes permanently in ${days} day${days !== 1 ? "s" : ""}`,
  willDeleteSoon: "Will be permanently deleted soon",
  restore: "Restore",
  purge: "Delete Forever",
  moviesCount: (n) => `${n} ${n === 1 ? "Movie" : "Movies"}`,
  chainTimes: "runs",
  movieCount: "movies",
  episodeRatings: "Episode Ratings",
  purgeTitle: "Delete Forever",
  purgeDesc: "Cannot be recovered after deletion",
  purgeCannotRecover: "Deleted items are kept here for 30 days, then automatically removed forever",
  // Settings — badge (extra)
  badgeCollectionTitle: "Badge Collection",
  evolvingBadge: "Evolving...",
  evolveBtn: (name) => `Evolve → ${name}`,
  earnedBadge: "Earned",
  // Supporter page
  supporterPageTitle: "Support Ticker",
  supporterPageSubtitle: "Get Supporter Badge Lv5",
  pendingStatus: "Pending Review",
  approvedStatus: "Approved! You're a Supporter",
  rejectedStatus: "Not Approved",
  pendingStatusDesc: "Slip submitted — waiting for admin review",
  approvedStatusDesc: "Supporter Badge Lv5 is unlocked. Go to Settings > Badge",
  rejectedStatusDesc: "Please contact an admin for more information",
  supporterBadgeDesc: "Special badge for Ticker supporters",
  supporterBenefits: [
    "Rainbow Supporter Badge Lv5 shown on your profile",
    "Doesn't affect existing Badge Lv1–4",
    "Supports Ticker's ongoing development",
  ],
  howToSupportTitle: "How to Support",
  paymentMethod: "Method",
  paymentAmount: "Amount",
  scanQrToPay: "Scan QR to pay",
  attachSlipNote: "Attach payment slip as proof",
  uploadSlipTitle: "Upload Slip",
  tapToSelectSlip: "Tap to select slip image",
  changeSlip: "Choose a different image",
  sendingRequest: "Sending...",
  submitRequest: "Submit Request",
  uploadSlipError: "Failed to upload image, please try again",
  // Popcorn Bucket
  popcornPageTitle: "Get Popcorn Bucket Badge",
  popcornPageSubtitle: "Verify You Own a Movie Page",
  popcornBadgeName: "Page/Creator",
  popcornBadgeDesc: "Content Creator",
  popcornBenefits: [
    "Popcorn bucket icon shown next to your name as a verified-page mark",
    "Not a level — does not affect existing badges",
    "Adds credibility to your movie page",
  ],
  popcornHowToTitle: "How Verification Works",
  popcornStep1: "Provide your page name and URL (Facebook / IG / TikTok, etc.)",
  popcornStep2: "Attach a screenshot proving you manage the page (e.g. admin dashboard)",
  popcornStep3: "Wait for admin review — once approved, the badge appears instantly",
  popcornPageNameLabel: "Movie Page Name",
  popcornPageNamePlaceholder: "e.g. Movie Review TH",
  popcornPageUrlLabel: "Page URL (Optional)",
  popcornPageUrlPlaceholder: "https://facebook.com/...",
  popcornUploadProofTitle: "Proof Image",
  popcornTapToSelectProof: "Tap to select proof image",
  popcornChangeProof: "Choose a different image",
  popcornPendingDesc: "Request submitted — waiting for admin review",
  popcornApprovedDesc: "You Are Officially Verified",
  popcornRejectedDesc: "Proof rejected — please resubmit or contact admin",
  popcornSettingsLabel: "Verify Identity",
  popcornSettingsDesc: "Verify your movie page identity",
  // Settings — badge
  noBadgeYet: "No Badge Yet",
  badgeNames: {
    1: { name: "Viewer",     desc: "First step into the world of cinema" },
    2: { name: "Fan",        desc: "Never misses a movie" },
    3: { name: "Cinephile",  desc: "In love with the art of cinema" },
    4: { name: "Critic",     desc: "A trusted voice" },
    5: { name: "Supporter",  desc: "Supports Ticker" },
  },
  // Chat
  chatTitle: "Messages",
  searchNamePlaceholder: "Search name...",
  noChats: "No chats yet",
  noChatsDesc: "Tap Message on anyone's profile to start a chat",
  manageChat: "Manage Chat",
  leaveConv: "Leave Conversation",
  leaveConvTitle: "Leave Conversation?",
  leaveConvDesc: "This chat will be removed from your list",
  cancelBtn: "Cancel",
  confirmBtn: "Confirm",
  deletingLabel: "Deleting...",
  noMessages: "No messages yet",
  imageMsg: "Image",
  messageRequestsLabel: (n) => `Message Requests (${n})`,
  messagesLabel: "Messages",
  // Chat conversation
  deletedCard: "Movie Card (deleted)",
  deletedMsg: "Deleted",
  deleteMessageTitle: "Delete this message?",
  deleteMessageDesc: "This message will be deleted for everyone",
  messageOptions: "Message Options",
  copyMessage: "Copy Message",
  deleteMessage: "Delete Message",
  uploadImageError: "Failed to send image, please try again",
  imageLoadError: "Unable to load image",
  typePlaceholder: "Type a message...",
  messageRequestFrom: (name) => `${name} wants to message you`,
  // Notifications
  notifTitle: "Notifications",
  searchNotifsPlaceholder: "Search notifications...",
  noNotifs: "No notifications",
  noNotifsDesc: "New notifications will appear here",
  acceptBtn: "Accept",
  declineBtn: "Decline",
  acceptedLabel: "Accepted",
  declinedLabel: "Declined",
  approveBtn: "Approve",
  denyBtn: "Deny",
  respondedLabel: "Responded",
  // Party invite
  partyInviteFrom: "Party invite from",
  partySizeLabel: (n) => `${n}-person party`,
  chooseSeat: "Choose your seat",
  seatTakenHint: "Grey = already taken",
  yourRating: "Your rating",
  alreadyAccepted: "Accepted",
  errSeatTaken: "This seat is already taken, please choose another",
  errDuplicateMovie: "You've already posted this movie",
  errGeneric: "Something went wrong, please try again",
  errChooseSeat: "Please choose a seat",
  errGiveRating: "Please give a rating",
  expiredLabel: "Expired",
  partyExpiredTitle: "Invite expired",
  partyExpiredDesc: "The original poster deleted the party card, so this invite has expired and can no longer be accepted.",
  // Home
  noTicketsFeed: "No Tickets posted yet",
  noUserFound: "No users found",
  noUserFoundDesc: "Try searching with a different name",
  searchUsersPlaceholder: "Search users...",
  // Search
  searchMoviePlaceholder: "Search movies, series...",
  noSearchResults: "No results found",
  emptySection: "No items available right now",
  sections: {
    trending:          { title: "Trending",           desc: "Everyone's watching these — join the conversation" },
    now_playing:       { title: "Now Playing",        desc: "Grab your wallet and head to the cinema now!" },
    legendary:         { title: "LEGENDARY",          desc: "Watch them and understand why people still talk about them" },
    cult_classic:      { title: "CULT CLASSIC",       desc: "Plots so wild you'll go 'wait, what?'" },
    "2am_deep_talk":   { title: "2 AM Deep Talk",     desc: "Still up at 2am? Here's something to keep you thinking till dawn" },
    brain_rot:         { title: "Brain Rot",          desc: "Let your brain melt — pure unfiltered energy" },
    main_character:    { title: "Main Character",     desc: "Watch it and feel like the hero... until you look in the mirror" },
    heartbreak:        { title: "Heartbreak Romance", desc: "Hurt once, forget it — here's round two" },
    chaos_red_flags:   { title: "Chaos & Red Flags",  desc: "Chaos with style — if you love this genre, we're the same" },
    anime:             { title: "Anime",              desc: "Easy to get in, impossible to leave — no breaks in this fandom" },
    tokusatsu:         { title: "Tokusatsu",          desc: "Explosions every episode, no excuses needed" },
    disney_dreamworks: { title: "Disney & DreamWorks", desc: "Heart-filling content that recharges your battery" },
    k_wave:            { title: "K-Wave",             desc: "Get your ramen ready and meet your oppas" },
    midnight_horror:   { title: "Midnight Horror",    desc: "Not as scary as you'd think... but keep the lights on anyway" },
    marvel_dc:         { title: "Marvel & DC",        desc: "Watch every film, or just jump in — either works" },
  },
  // Following feed
  noPostsYet: "No posts yet",
  noPostsYetDesc: "No posts in the system right now",
  // Bookmarks
  bookmarksTitle: "Bookmarks",
  tabAll: "All",
  noBookmarks: "No bookmarks yet",
  noBookmarksDesc: "Bookmark tickets, movies, and Chains here",
  noMovieBookmarks: "No movies bookmarked",
  noMovieBookmarksDesc: "Bookmark movies you want to watch",
  noTicketBookmarks: "No tickets bookmarked",
  noTicketBookmarksDesc: "Bookmark tickets you like here",
  noChainBookmarks: "No Chains bookmarked",
  noChainBookmarksDesc: "Bookmark Chains you like here",
  // Ticket detail
  cardNotFound: "Card not found",
  backHome: "Back to Home",
  ratingExcellent: "Excellent",
  ratingVeryGood: "Very Good",
  ratingGood: "Good",
  ratingOkay: "Okay",
  ratingBad: "Poor",
  commentsLabel: "Comments",
  noCommentsYet: "No comments yet",
  beFirstToComment: "Be the first to comment",
  addCommentPlaceholder: "Add a comment...",
  sendToFriend: "Send to a friend",
  searchShortPlaceholder: "Search...",
  usersLabel: "Users",
  recentChatsLabel: "Recent chats",
  userLabel: "User",
  noUsersFoundShort: "No users found",
  relativeTimeShort: (diffMs) => {
    const mins  = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days  = Math.floor(diffMs / 86400000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m`;
    if (hours < 24) return `${hours}h`;
    return `${days}d`;
  },
  deleteCardTitle: "Delete this card",
  deleteCardDesc: "This card will be permanently deleted and cannot be recovered",
  deleteCardBtn: "Delete Card",
  // Create Ticket
  stepSelectMovie: "Select Movie",
  stepPostTicket: "Post Ticket",
  errNoRating: "Please rate before posting",
  errDuplicateEpisode: "You've already posted this episode, try another one",
  errDuplicateGeneral: "You've already posted the general watch of this series, choose an episode instead",
  searchAnyLang: "Search movies in any language...",
  savedDraftsLabel: "Saved Drafts",
  trendingNow: "Trending Now",
  whatDidYouWatch: "What did you watch?",
  searchForMovieDesc: "Search for a movie to create a memory card",
  noMovieFoundTryAgain: "No movies found, try again",
  tapToFlip: "Tap card to flip",
  themeLabel: "Theme",
  classicTheme: "Classic",
  posterTheme: "Poster",
  chooseCoverLabel: "Choose cover (scene scan)",
  noBackdropFound: "No backdrop found for this movie",
  dragToAdjust: "Drag to adjust position",
  memoryLabel: "Memory",
  memoryPlaceholder: "A short sentence about your memory...",
  noMemoryYet: "No memory yet",
  privateMemory: "Private memory",
  privateMemoryHint: "Private memory — tap to request",
  spoilerAlert: "Spoiler alert",
  spoilerAlertDesc: "This post contains spoilers",
  spoiler: "Spoiler",
  dyingStarLabel: "Dying Star",
  report: "Report",
  reportReasons: ["Spam", "Inappropriate", "Harassment", "Spoiler without warning", "Other"],
  youPrefix: "You: ",
  episodeLabel: "Select Episode",
  episodeOptional: "Choose episode (optional)",
  noEpisodeData: "No episode data found",
  captionLabel: "Caption",
  captionPlaceholder: "Tell your friends about this movie...",
  detailsLabel: "Details",
  locationPlaceholder: "Location...",
  partyLabel: "Party",
  partyDesc: "Watch together",
  partyTicketCount: "How many tickets?",
  yourTicketNum: "Which ticket is yours?",
  inviteFriendsLabel: (n) => `Invite friends (${n})`,
  userSearchPlaceholder: "Search users...",
  privateCardLabel: "Private Card",
  postPartyTicketBtn: "Post Party Ticket",
  postTicketBtn: "Post Ticket",
  saveDraftTitle: "Save Draft?",
  saveDraftDesc: "You haven't finished your ticket. Save it to continue later?",
  saveDraftBtn: "Save Draft",
  discardBtn: "Discard",
  continueBtn: "Continue",
  // Create Chain
  chainAddedLabel: "Added",
  durationHour: "hour(s)",
  durationDay: "day(s)",
  durationWeek: "week(s)",
  dragToSort: "Drag to reorder",
  errChainNoTitle: "Please enter a Chain name",
  errChainMinMovie: "Add at least 1 movie",
  createChainTitle: "Create Chain",
  addMovieLabel: "Add Movie",
  chainNameLabel: "Name",
  chainNamePlaceholder: "Your Chain name...",
  chainDescLabel: "Description",
  chainDescPlaceholder: "Describe your Chain... (optional)",
  errChainNameRequired: "Please add a Chain name",
  chainUntitled: "Untitled",
  moviesInChainLabel: "Movies in Chain",
  sortDoneBtn: "Done",
  reorderBtn: "Reorder",
  closeBtn: "Close",
  noMoviesFound: "No Movies Found",
  noMoviesInChain: "No movies yet — tap Add Movie",
  chainTimerDesc: "Set a time limit for this Chain",
  communityAddDesc: "Let others add movies to the list",
  huntModeLabel: "Hunt",
  huntModeDesc: "Let the community find a movie — no starting movie needed",
  huntChainBanner: "Help out! Add movies you think fit this post",
  huntFoundBadge: "Found",
  huntFoundTitle: (n: number) => `Found ${n} Movie${n !== 1 ? "s" : ""}`,
  huntFoundToggleOn: "Mark as Found",
  huntFoundToggleOff: "Unmark as Found",
  detectiveTitle: "Movie Detective",
  detectiveKeyword: "Keyword",
  detectiveKeywordPlaceholder: "Title, Actor, Director...",
  detectiveGenre: "Genre",
  detectiveDecade: "Era",
  detectiveLang: "Language",
  detectiveAny: "Any",
  detectiveFind: "Find Movies",
  detectiveHint: "Type a Keyword or Choose Filters, Then Tap Find Movies",
  creatingChain: "Creating...",
  unnamedDraft: "Untitled",
  saveDraftChainTitle: "Save Draft?",
  saveDraftChainDesc: "You haven't finished your Chain. Save it to continue later?",
  savedDraftChainLabel: "Saved Draft",
  startOverBtn: "Start Over",
  backBtn: "Go Back",
  // Settings — badge (extra)
  badgeCollectionDesc: "Collect XP to level up your Badge",
  badgeCollectionDescPopcorn: "Verify your page or creator identity",
  xpPosts: "Posts",
  xpParty: "Party",
  howToEarnXP: "How to Earn XP",
  xpPerPost: "+5 XP / post",
  xpPerTag: "+3 XP / friend",
  xpPerParty: "+10 XP / party",
  xpNeeded: (n) => `Need ${n} XP`,
  xpNeededTotal: (n) => `Need ${n} XP total`,
  claimBadgeBtn: "Claim First Badge!",
  claimingBadge: "Claiming...",
  collectXpDesc: "Earn XP from posts · tagging friends · parties",
  pendingReview: "⏳ Pending Review",
  pendingReviewDesc: "Slip submitted — waiting for admin review",
  supportThanks: "Thank you for supporting Ticker ♥",
  // Settings — account dialogs
  makePublicTitle: "Make Profile Public",
  makePrivateTitle: "Make Profile Private",
  makePublicDesc: "Anyone will be able to view your profile",
  makePrivateDesc: "Only people you approve can view your profile",
  savingChanges: "Saving...",
  logoutTitle: "Log Out",
  logoutConfirmDesc: "Are you sure you want to log out?",
  loggingOut: "Logging out...",
  deleteAccountLabel: "Delete Account",
  deleteAccountLabelDesc: "Permanently delete your account and all data",
  deleteAccountTitle: "Permanently Delete Account",
  deleteAccountPermText: (word) => `Your account and all data will be permanently deleted. Type ${word} to confirm`,
  deleteAccountPlaceholder: "Type 'delete account' to confirm",
  deleteAccountConfirmWord: "delete account",
  deletingAccountLabel: "Deleting...",
  trashEmpty: "Trash is Empty",
  trashEmptyDesc: "Tickets and Chains you delete will appear here",
  trashSectionNote: "Deleted items are kept here for 30 days, then automatically removed forever",
  settingsPageTitle: "Settings",
  trashPageTitle: "Trash",
  // Chain detail
  chainNotFound: "Chain not found",
  cancelChainBtn: "Cancel Chain",
  cancelingChain: "Canceling...",
  loginToJoin: "Tap + to sign in or sign up",
  chainNowBtn: "Start Chain",
  startingChain: "Starting...",
  shareMoviesYouLove: "Share movies you love together",
  totalTimeLabel: "Total Time",
  chainingNow: (name) => `${name} is Chaining`,
  movieListLabel: "Movies",
  whyLikePlaceholder: "Why do you like this movie... (optional)",
  addCommentChain: "Add a comment...",
  markWatched: "Mark Watched",
  savingWatched: "Saving...",
  addMovieToChain: "Add Movie to Chain",
  chainFullMsg: "This Chain is full",
  addBtn: "Add",
  alreadyInChain: "Already added",
  searchMovieChain: "Search movies...",
  addedByLabel: "Added by @",
  saveBtn: "Save",
  // ── TicketCard feed ───────────────────────────────────────────────
  user: "User",
  noCommentsBeFirst: "No comments yet — be the first!",
  signInToLike: "Tap + to sign in or sign up",
  timeJustNow: "Just now",
  timeMin: "m",
  timeHr: "h",
  timeDay: "d",
  confirmDeleteAgain: "Tap again to confirm delete",
  deletePost: "Delete post",
  moveToTrashTitle: "Move to Trash?",
  moveToTrashDesc: "Can be recovered within 30 days",
  confirmDeleteLabel: "Confirm Delete",
  editPost: "Edit post",
  makePublic: "Make public",
  setPrivate: "Set to Private",
  showLikes: "Show likes",
  hideLikes: "Hide likes",
  enableComments: "Enable comments",
  disableComments: "Disable comments",
  moveToTrash: "Move to Trash",
  reasonPlaceholder: "Tell us why you like this movie... (optional)",
  reviewPlaceholder: "Tell your friends about this movie...",
  watchLocationPlaceholder: "Location...",
  collapse: "Less",
  readMore: "Read more",
  // Report / Contact sheet
  reportTicketTitle: "Report Ticket",
  reportUserTitle: "Report User",
  reportCommentTitle: "Report Comment",
  reportSelectReason: "Select a reason",
  contactReplyPromise: "We'll reply as soon as possible",
  reasonSpam: "Spam / Advertisement",
  reasonInappropriate: "Inappropriate content",
  reasonHarassment: "Harassment / Abuse",
  reasonImpersonation: "Impersonation",
  reasonOther: "Other",
  contactBug: "Bug or usage issue",
  contactFeature: "Request a new feature",
  contactAccount: "Account issue",
  contactContent: "Content issue / Report",
  contactGeneral: "General inquiry",
  nextBtn: "Next",
  sendBtn: "Send",
  emailOptionalLabel: "Email (optional)",
  detailsRequiredLabel: "Details *",
  detailsOptionalLabel: "Additional details (optional)",
  describeIssuePlaceholder: "Describe your issue or question...",
  tellUsMorePlaceholder: "Tell us more about the issue...",
  contactSentTitle: "Message sent!",
  reportedTitle: "Reported!",
  contactSentDesc: "The Ticker team received your message. We'll review and reply as soon as possible.",
  reportedDesc: "Our team will review your report. Thank you for helping keep Ticker safe.",
  // Profile — edit sheet
  tapToChangeAvatar: "Tap to change profile photo",
  displayNameLabel: "Display Name",
  displayNamePlaceholder: "Your name",
  bioLabel: "Bio",
  usernameLabel: "Username",
  bioPlaceholder: "Write a little about yourself...",
  usernameChangeCooldown: "Can change every 7 days",
  usernameAvailableLabel: "Username available",
  usernameTakenLabel: "Username already taken",
  usernameFormatHint: "Letters a-z, 0-9, _ (3–30 characters)",
  errDisplayNameEmpty: "Display name cannot be empty",
  errUsernameInvalid: "Invalid username",
  errUsernameChangeFailed: "Failed to change username",
  errSaveFailed: "Failed to save, please try again",
  errUploadAvatar: "Failed to upload image, please try again",
  errGenericRetry: "Something went wrong, please try again",
  // Profile — chain subtabs
  chainSubTabPlayed: "Played",
  chainSubTabCreated: "Created",
  noChainPlayedOwn: "You haven't played any Chain yet",
  noChainPlayedOther: (name) => `${name} hasn't played any Chain`,
  exploreChainsBtn: "Explore Chains",
  noChainCreatedOwn: "You haven't created any Chain yet",
  noChainCreatedOther: (name) => `${name} hasn't created any Chain`,
  createNewChainBtn: "+ Create New Chain",
  showChainCountLabel: "Show Chain Count",
  hideChainCountLabel: "Hide Chain Count",
  privateAccountTitle: "Private Account",
  privateAccountDesc: "Follow this account to see all their films",
  // Movie detail
  trailerLabel: "Trailer",
  directorLabel: "Director",
  castLabel: "Cast",
  watchOnLabel: "Available on",
  seeMore: "... see more",
  // Chains feed
  noChainsFeed: "No Chains posts yet",

  // BottomNav menu
  signupMenuTitle: "Sign Up",
  signupMenuDesc: "Create an account and start tracking movies",
  loginMenuTitle: "Sign In",
  loginMenuDesc: "Welcome back to your account",
  createTicketMenuDesc: "Save your movie memories",
  createChainMenuDesc: "Curate movies for others to chain",
  // Edit pages
  editCardTitle: "Edit Card",
  editChainTitle: "Edit Chain",
  // Create / edit ticket misc
  dateLabelPlaceholder: "Date...",
  selectMovieAria: (name) => `Select ${name}`,
  // Share Story modal
  errSaveCardFailed: "Save failed, please try again",
  savedSuccess: "Saved!",
  saveCardToStoryDesc: "Save card to your device to share to story",
  savedToDeviceTitle: "Saved to device",
  openGalleryHint: "Open your gallery app and post to story",
  saveCardSubdesc: "Both front and back of the card will be saved to your device",
  iosLongPressHint: "Press and hold the image above, then choose “Add to Photos” to save",
  comingSoon: "Coming Soon",
  savingShort: "Saving",
  sendInChatBtn: "Send in Chat",
  copiedLabel: "Copied",
  copyLinkBtn: "Copy Link",
};

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Strings;
}

const LangContext = createContext<LangCtx>({
  lang: "th",
  setLang: () => {},
  t: TH,
});

// Global fetch wrapper — injects x-ui-lang on every /api/ request so that
// raw fetch() callers (not just the OpenAPI client) get localized responses.
// Initialize from localStorage at module load so the very first API request
// (which can fire before LangProvider's effect runs) already has the user's
// chosen language — otherwise category caches lock to English on first visit.
let _currentLang: Lang = (typeof window !== "undefined") ? loadLang() : "en";
if (typeof window !== "undefined" && !(window as unknown as { __ticker_fetch_patched?: boolean }).__ticker_fetch_patched) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === "string" ? input :
        input instanceof URL ? input.href :
        input instanceof Request ? input.url : "";
      if (url.includes("/api/")) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has("x-ui-lang")) headers.set("x-ui-lang", _currentLang);
        return originalFetch(input, { ...init, headers });
      }
    } catch {}
    return originalFetch(input, init);
  };
  (window as unknown as { __ticker_fetch_patched?: boolean }).__ticker_fetch_patched = true;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang);
  // Read QueryClient via context directly so this provider also works in
  // detached React roots (e.g. ShareStoryModal's snapshot capture root) that
  // intentionally don't mount a QueryClientProvider.
  const qc = useContext(QueryClientContext);
  const firstRun = useRef(true);

  useEffect(() => {
    setUILang(lang);
    _currentLang = lang;
    // Sync the active language to the server (best-effort) so push
    // notifications go out in the right language. Runs on mount + on change.
    fetch("/api/users/me/lang", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang }),
    }).catch(() => { /* unauthenticated / offline — fine */ });
    // Sync the device timezone too so timed push notifications fire at the
    // user's local 0/12/20, not Bangkok hours.
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        fetch("/api/users/me/timezone", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timezone: tz }),
        }).catch(() => { /* unauthenticated / offline — fine */ });
      }
    } catch { /* Intl unavailable — skip */ }
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    // Refetch all server data so localized payloads (TMDB titles, overviews,
    // upcoming feed, trending, etc.) update immediately on language switch.
    qc?.invalidateQueries();
  }, [lang, qc]);

  const setLang = useCallback((l: Lang) => {
    // Update the fetch-wrapper lang synchronously so any React Query fetches
    // that fire immediately after the state update (before effects run) already
    // carry the correct x-ui-lang header. The useEffect below also sets these
    // as a safety net, but the synchronous update here is what matters for the
    // first refetch triggered by the queryKey change.
    _currentLang = l;
    try { setUILang(l); } catch {}
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);

  return (
    <LangContext.Provider value={{ lang, setLang, t: lang === "th" ? TH : EN }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}

// ── Auth error code → localized message ────────────────────────────
const AUTH_ERROR_MESSAGES: Record<string, { th: string; en: string }> = {
  too_many_requests: {
    th: "คำขอเยอะเกินไป กรุณาลองใหม่ในภายหลัง",
    en: "Too many requests, please try again later",
  },
  invalid_email: { th: "อีเมลไม่ถูกต้อง", en: "Invalid email address" },
  email_domain_not_allowed: {
    th: "รองรับเฉพาะอีเมลจาก Gmail, Outlook, Hotmail, Yahoo, iCloud, ProtonMail และ Zoho เท่านั้น",
    en: "Only Gmail, Outlook, Hotmail, Yahoo, iCloud, ProtonMail, and Zoho email addresses are supported",
  },
  password_too_short: {
    th: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร",
    en: "Password must be at least 8 characters",
  },
  password_invalid_chars: {
    th: "รหัสผ่านต้องใช้ตัวอักษรภาษาอังกฤษและสัญลักษณ์เท่านั้น (ไม่รับภาษาไทย)",
    en: "Password must use only English letters and symbols (Thai not allowed)",
  },
  password_no_letter: {
    th: "รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว",
    en: "Password must contain at least one letter",
  },
  password_no_digit_or_symbol: {
    th: "รหัสผ่านต้องมีตัวเลขหรือสัญลักษณ์อย่างน้อย 1 ตัว",
    en: "Password must contain at least one number or symbol",
  },
  disposable_email: {
    th: "ไม่รับอีเมลชั่วคราว กรุณาใช้อีเมลจริง",
    en: "Temporary email addresses are not allowed, please use a real email",
  },
  email_taken: { th: "อีเมลนี้ถูกใช้งานแล้ว", en: "This email is already in use" },
  invalid_credentials: {
    th: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    en: "Incorrect email or password",
  },
  invalid_token: {
    th: "ลิงก์รีเซ็ตรหัสผ่านหมดอายุหรือไม่ถูกต้อง",
    en: "Reset link is invalid or expired",
  },
};

export function authErrorMessage(code: string | undefined | null, lang: Lang): string | null {
  if (!code) return null;
  const entry = AUTH_ERROR_MESSAGES[code];
  if (!entry) return null;
  return entry[lang];
}

// ── Year / date formatting helpers ─────────────────────────────────
// Thai displays in Buddhist Era (พ.ศ. = ค.ศ. + 543), English keeps CE.
export function displayYear(year: number | string | null | undefined, lang: Lang): string {
  if (year == null || year === "") return "";
  const y = typeof year === "string" ? parseInt(year, 10) : year;
  if (!y || Number.isNaN(y)) return String(year);
  return lang === "th" ? String(y + 543) : String(y);
}

export function displayDate(
  d: string | Date | null | undefined,
  lang: Lang,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const locale = lang === "th" ? "th-TH-u-ca-buddhist" : "en-US";
  return date.toLocaleDateString(locale, opts);
}
