export interface CommentReply {
  id: string
  body: string
  // Who wrote the reply: 'user' (typed in the UI) or 'agent' (posted via the
  // API by a coding agent). Optional for backward compatibility — treat a
  // missing value as 'agent'.
  author?: 'user' | 'agent'
  createdAt: number
}

export interface ReviewComment {
  id: string
  filePath: string
  side: 'deletions' | 'additions'
  lineNumber: number
  lineContent: string
  body: string
  status: 'open' | 'resolved'
  createdAt: number
  editedAt?: number
  replies: CommentReply[]
}
