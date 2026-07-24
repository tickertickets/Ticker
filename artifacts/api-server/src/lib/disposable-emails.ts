const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com","tempmail.com","guerrillamail.com","yopmail.com",
  "guerrillamail.info","guerrillamail.biz","guerrillamail.de","guerrillamail.net",
  "guerrillamail.org","sharklasers.com","grr.la","spam4.me",
  "trashmail.com","trashmail.at","trashmail.io","trashmail.me","trashmail.net",
  "trashmail.fr","trashmail.xyz","dispostable.com","mailnesia.com",
  "mailnull.com","spamgourmet.com","binkmail.com","safetymail.info",
  "gishpuppy.com","maildrop.cc","10minutemail.com","10minutemail.net",
  "20minutemail.com","discard.email","fakeinbox.com","fakeinbox.net",
  "getairmail.com","filzmail.com","trbvm.com","tmailinator.com",
  "throwam.com","temp-mail.org","tempinbox.com","mailtemp.net",
  "disposablemail.com","mintemail.com","spamex.com","mailexpire.com",
  "mailnew.com","spambox.us","spambox.info","mailzilla.com",
  "yopmail.fr","cool.fr.nf","jetable.fr.nf","nospam.ze.tc",
  "nomail.xl.cx","mega.zik.dj","speed.1s.fr","courriel.fr.nf",
  "moncourrier.fr.nf","monemail.fr.nf","monmail.fr.nf",
  "mailtemp.info","emailondeck.com","tempail.com","tempr.email",
  "throwam.com","burnermail.io","inboxbear.com","inboxkitten.com",
  "moakt.com","mohmal.com","owlpic.com","getnada.com","zetmail.com",
  "crazymailing.com","spamgrap.com","spamherelots.com","spamhere.eu",
  "mailfreeonline.com","mailforspam.com","spamdecoy.net","spam.la",
  "byom.de","klzlk.com","lroid.com","mxsf.xyz","pfui.ru",
  "dispostable.com","discardmail.com","discardmail.de",
  "deadaddress.com","mailscrap.com","jetable.com","jetable.net",
  "jetable.org","noclickemail.com","pookmail.com","temporaryemail.net",
  "spamevader.com","wegwerfmail.de","wegwerfmail.net","wegwerfmail.org",
  "sogetthis.com","soodonims.com","spamgap.com","spamtrail.com",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}
