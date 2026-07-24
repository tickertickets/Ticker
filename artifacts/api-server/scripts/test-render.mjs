import { writeFile } from "node:fs/promises";
import { renderTicketCardPng } from "../dist/services/card-render.mjs";

const ticket = {
  movieTitle: "The Mummy: Tomb of the Dragon Emperor",
  movieYear: 2008,
  posterUrl: "https://image.tmdb.org/t/p/w500/iAFiOR9OkTorRz1DVlsgDKiwaX0.jpg",
  genre: "Action, Adventure, Fantasy",
  rating: 4,
  ratingType: "star",
  watchedAt: "2024-08-15",
  location: "House",
  memoryNote:
    "หนังสนุกมากกกก!! ฉากต่อสู้ในสุสานคือดีงาม Brendan Fraser กลับมาสุดยอด!",
  user: { username: "moviefan" },
  cardTheme: "classic",
  isPrivateMemory: false,
};

const png = await renderTicketCardPng(ticket, { lang: "th" });
await writeFile(new URL("../tmp-classic.png", import.meta.url), png);
console.log("Wrote classic →", png.length, "bytes");

const poster = {
  ...ticket,
  movieTitle: "Dune: Part Two",
  cardTheme: "poster",
  cardBackdropUrl:
    "https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg",
  cardBackdropOffsetX: 50,
  rating: 5,
};

const png2 = await renderTicketCardPng(poster, { lang: "en" });
await writeFile(new URL("../tmp-poster.png", import.meta.url), png2);
console.log("Wrote poster →", png2.length, "bytes");
