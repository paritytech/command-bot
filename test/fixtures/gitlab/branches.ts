export function getGitLabBranchesPayload(params: { branchName: string }): string {
  return JSON.stringify([
    {
      name: params.branchName,
      merged: false,
      protected: true,
      default: true,
      developers_can_push: false,
      developers_can_merge: false,
      can_push: true,
      // Following parts don't make a difference now, but later we might need to specify these as well
      web_url: "https://gitlab.example.com/my-group/my-project/-/tree/main",
      commit: {
        author_email: "john@example.com",
        author_name: "John Smith",
        authored_date: "2012-06-27T05:51:39-07:00",
        committed_date: "2012-06-28T03:44:20-07:00",
        committer_email: "john@example.com",
        committer_name: "John Smith",
        id: "7b5c3cc8be40ee161ae89a06bba6229da1032a0c",
        short_id: "7b5c3cc",
        title: "add projects API",
        message: "add projects API",
        parent_ids: ["4ad91d3c1144c406e50c7b33bae684bd6837faf8"],
      },
    },
  ]);
}
