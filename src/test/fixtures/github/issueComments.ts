export function getIssueCommentsPayload(params: {
  org: string;
  repo: string;
  comments: { author: string; body: string; id: number }[];
}): string {
  const comments = params.comments.map((comment) => getCommentPayload({ org: params.org, repo: params.repo, comment }));

  return JSON.stringify(comments);
}

export function getIssueCommentPayload(params: {
  org: string;
  repo: string;
  comment: { author: string; body: string; id: number };
}): string {
  return JSON.stringify(getCommentPayload(params));
}

function getCommentPayload(params: {
  org: string;
  repo: string;
  comment: { author: string; body: string; id: number };
}) {
  return {
    url: `https://api.github.com/repos/${params.org}/${params.repo}/issues/comments/${params.comment.id}`,
    html_url: `https://github.com/${params.org}/${params.repo}/pull/4#issuecomment-${params.comment.id}`,
    issue_url: `https://api.github.com/repos/${params.org}/${params.repo}/issues/4`,
    id: params.comment.id,
    node_id: "IC_kwDOG7BDBs5FueDP",
    user: {
      login: params.comment.author,
      id: 588262,
      node_id: "MDQ6VXNlcjU4ODI2Mg==",
      avatar_url: "https://avatars.githubusercontent.com/u/588262?v=4",
      gravatar_id: "",
      url: `https://api.github.com/users/${params.comment.author}`,
      html_url: `https://github.com/${params.comment.author}`,
      followers_url: `https://api.github.com/users/${params.comment.author}/followers`,
      following_url: `https://api.github.com/users/${params.comment.author}/following{/other_user}`,
      gists_url: `https://api.github.com/users/${params.comment.author}/gists{/gist_id}`,
      starred_url: `https://api.github.com/users/${params.comment.author}/starred{/owner}{/repo}`,
      subscriptions_url: `https://api.github.com/users/${params.comment.author}/subscriptions`,
      organizations_url: `https://api.github.com/users/${params.comment.author}/orgs`,
      repos_url: `https://api.github.com/users/${params.comment.author}/repos`,
      events_url: `https://api.github.com/users/${params.comment.author}/events{/privacy}`,
      received_events_url: `https://api.github.com/users/${params.comment.author}/received_events`,
      type: "User",
      site_admin: false,
    },
    created_at: "2022-06-29T10:25:43Z",
    updated_at: "2022-06-29T10:25:43Z",
    author_association: "MEMBER",
    body: params.comment.body,
    reactions: {
      url: `https://api.github.com/repos/${params.org}/${params.repo}/issues/comments/${params.comment.id}/reactions`,
      total_count: 0,
      "+1": 0,
      "-1": 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
    performed_via_github_app: null,
  };
}
