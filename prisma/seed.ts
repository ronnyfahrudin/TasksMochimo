import { PrismaClient, TaskCategory, ProofType } from "@prisma/client";

const prisma = new PrismaClient();

const tasks = [
  // ───────── SOCIAL ─────────
  {
    slug: "follow-mochimo-twitter",
    title: "Follow @mochimo on X",
    description:
      "Follow the official Mochimo account on X (Twitter). Submit the URL of your profile so we can verify.",
    category: TaskCategory.SOCIAL,
    points: 50,
    proofType: ProofType.TWEET_URL,
    proofUrlHint: "https://x.com/",
    maxPerUser: 1,
    autoApprove: false,
    meta: { account: "mochimo" },
  },
  {
    slug: "retweet-pinned",
    title: "Retweet the pinned Mochimo announcement",
    description:
      "Find the pinned tweet on @mochimo and retweet it. Paste the URL of your retweet.",
    category: TaskCategory.SOCIAL,
    points: 30,
    proofType: ProofType.TWEET_URL,
    proofUrlHint: "https://x.com/",
    maxPerUser: 1,
    autoApprove: false,
    meta: { target: "pinned" },
  },
  {
    slug: "quote-tweet-mcm",
    title: "Quote tweet with #Mochimo",
    description:
      "Quote tweet a Mochimo post with your own commentary, include #Mochimo and $MCM. Submit the quote-tweet URL.",
    category: TaskCategory.SOCIAL,
    points: 80,
    proofType: ProofType.TWEET_URL,
    proofUrlHint: "https://x.com/",
    maxPerUser: 5,
    autoApprove: false,
    meta: { hashtags: ["Mochimo", "MCM"] },
  },

  // ───────── CONTENT ─────────
  {
    slug: "write-medium-article",
    title: "Write a Medium article about Mochimo",
    description:
      "Publish a thoughtful Medium article (>=500 words) about Mochimo's quantum-resistant tech. Submit the URL.",
    category: TaskCategory.CONTENT,
    points: 500,
    proofType: ProofType.MEDIUM_URL,
    proofUrlHint: "https://medium.com/",
    maxPerUser: 3,
    autoApprove: false,
  },
  {
    slug: "youtube-explainer",
    title: "Publish a YouTube explainer video",
    description:
      "Create a YouTube video (>=2 min) explaining Mochimo. Submit the video URL.",
    category: TaskCategory.CONTENT,
    points: 800,
    proofType: ProofType.YOUTUBE_URL,
    proofUrlHint: "https://youtube.com/",
    maxPerUser: 3,
    autoApprove: false,
  },
  {
    slug: "twitter-thread",
    title: "Write a Twitter/X thread (>=5 posts)",
    description:
      "Publish a thread of at least 5 posts breaking down a Mochimo concept. Submit the URL of the first tweet.",
    category: TaskCategory.CONTENT,
    points: 200,
    proofType: ProofType.TWEET_URL,
    proofUrlHint: "https://x.com/",
    maxPerUser: 5,
    autoApprove: false,
  },

  // ───────── REFERRAL ─────────
  {
    slug: "refer-friend",
    title: "Refer a friend",
    description:
      "Share your referral link. You earn 100 points each time a new user signs up with your code and connects Twitter + a valid Mochimo address.",
    category: TaskCategory.REFERRAL,
    points: 100,
    proofType: ProofType.AUTO,
    autoApprove: true,
    maxPerUser: null,
  },

  // ───────── DAILY ─────────
  {
    slug: "daily-checkin",
    title: "Daily check-in",
    description: "Sign in once per day and click the check-in button.",
    category: TaskCategory.DAILY,
    points: 10,
    proofType: ProofType.NONE,
    autoApprove: true,
    cooldownHrs: 20,
    maxPerUser: null,
  },
  {
    slug: "daily-like-mcm-post",
    title: "Daily: Like @mochimo's latest tweet",
    description:
      "Like the most recent @mochimo tweet today. Paste the tweet URL — duplicate tweets are rejected.",
    category: TaskCategory.DAILY,
    points: 15,
    proofType: ProofType.TWEET_URL,
    proofUrlHint: "https://x.com/mochimo/status/...",
    cooldownHrs: 20,
    maxPerUser: null,
    autoApprove: false,
  },
  {
    slug: "daily-retweet-mcm",
    title: "Daily: Retweet @mochimo today",
    description:
      "Retweet a fresh @mochimo tweet and submit the URL of your retweet. One tweet per day, no repeats.",
    category: TaskCategory.DAILY,
    points: 25,
    proofType: ProofType.TWEET_URL,
    proofUrlHint: "https://x.com/",
    cooldownHrs: 20,
    maxPerUser: null,
    autoApprove: false,
  },
  {
    slug: "daily-quote-mcm",
    title: "Daily: Quote-tweet @mochimo with #Mochimo",
    description:
      "Quote-tweet a @mochimo post today with your own commentary, include #Mochimo or $MCM. Submit the quote-tweet URL.",
    category: TaskCategory.DAILY,
    points: 40,
    proofType: ProofType.TWEET_URL,
    proofUrlHint: "https://x.com/",
    cooldownHrs: 20,
    maxPerUser: null,
    autoApprove: false,
    meta: { hashtags: ["Mochimo", "MCM"] },
  },
];

function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  console.log("Seeding tasks…");
  for (const t of tasks) {
    await prisma.task.upsert({
      where: { slug: t.slug },
      update: t,
      create: t,
    });
  }

  await prisma.appState.upsert({
    where: { id: 1 },
    update: { currentPeriod: currentPeriod() },
    create: { id: 1, currentPeriod: currentPeriod() },
  });

  console.log(`Seeded ${tasks.length} tasks. Period = ${currentPeriod()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
