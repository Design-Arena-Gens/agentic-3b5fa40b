import { NextResponse } from "next/server";

type RedditListing = {
  data?: {
    children: { data: RedditPost }[];
  };
};

type RedditPost = {
  id: string;
  title: string;
  selftext: string;
  url: string;
  author: string;
  created_utc: number;
  permalink: string;
  stickied: boolean;
  over_18: boolean;
  thumbnail: string;
  num_comments: number;
  upvote_ratio: number;
};

export type IndiaUpdate = {
  id: string;
  title: string;
  summary: string;
  url: string;
  author: string;
  postedAt: string;
  stats: {
    comments: number;
    upvoteRatio: number;
  };
};

const SUBREDDIT = "india";
const ITEMS_LIMIT = 10;

export async function GET() {
  try {
    const response = await fetch(
      `https://www.reddit.com/r/${SUBREDDIT}/top/.json?limit=${ITEMS_LIMIT}&t=day`,
      {
        headers: {
          "User-Agent": "agentic-video-generator/1.0",
        },
        next: {
          revalidate: 60,
        },
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch India updates." },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as RedditListing;
    const posts = payload.data?.children ?? [];

    const items: IndiaUpdate[] = posts
      .map((item) => item.data)
      .filter((post): post is RedditPost => Boolean(post?.id))
      .filter((post) => !post.stickied && !post.over_18)
      .slice(0, ITEMS_LIMIT)
      .map((post) => {
        const summarySource = post.selftext.trim();
        const summary =
          summarySource ||
          `Stay informed: ${post.title.replace(/\.$/, "")}. For the full context, visit the linked article.`;

        return {
          id: post.id,
          title: post.title,
          summary: summary.length > 600 ? `${summary.slice(0, 597)}...` : summary,
          url: `https://www.reddit.com${post.permalink}`,
          author: post.author,
          postedAt: new Date(post.created_utc * 1000).toISOString(),
          stats: {
            comments: post.num_comments ?? 0,
            upvoteRatio: post.upvote_ratio ?? 0,
          },
        };
      });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("india-news route error", error);
    return NextResponse.json(
      { error: "Unexpected error while fetching updates." },
      { status: 500 },
    );
  }
}

