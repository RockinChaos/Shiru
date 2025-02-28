export type Media = {
  id: number
  idMal: number
  title: {
    romaji?: string
    english?: string
    native?: string
    userPreferred: string
  }
  description?: string
  season?: string
  seasonYear?: string
  type: string
  format: string
  status: string
  episodes?: number
  duration?: number
  averageScore?: number
  genres?: string[]
  tags?: {
    name: string
    rank: number
  }[]
  isFavourite: boolean
  coverImage?: {
    extraLarge: string
    medium: string
    color: string
  }
  source?: string
  countryOfOrigin?: string
  isAdult?: boolean
  bannerImage?: string
  synonyms?: string[]
  stats: {
    scoreDistribution: {
      score: number
      amount: number
    }[]
  }
  nextAiringEpisode?: {
    episode: number
    airingAt: number
  }
  trailer?: {
    id: string
    site: string
  }
  streamingEpisodes?: {
    title: string
    thumbnail: string
  }[]
  mediaListEntry?: {
    id: number
    progress: number
    repeat: number
    status?: string
    customLists?: { name: string; enabled: boolean }[]
    score?: number
    startedAt?: {
      year: number
      month: number
      day: number
    }
    completedAt?: {
      year: number
      month: number
      day: number
    }
  }
  studios?: {
    nodes: {
      name: string
    }[]
  }
  airingSchedule?: {
    nodes?: {
      episode: number
      airingAt: number
    }[]
  }
  relations?: {
    edges: {
      relationType: string
      node: {
        id: number
        type: string
        format?: string
        seasonYear?: number
      }
    }[]
  }
  recommendations?: {
    edges?: {
      node: {
        rating: number
        mediaRecommendation: {
          id: number
        }
      }
    }[]
  }
}

export type Following = {
  status: string
  score: number
  user: {
    id: number
    name: string
    avatar: {
      medium: string
    }
  }
}

export type MediaListMedia = {
  id: number
  status: string
  mediaListEntry: {
    progress: number
  }
  nextAiringEpisode?: {
    episode: number
  }
  relations?: {
    edges: {
      relationType: string
      node: {
        id: number
        type: string
        format?: string
      }
    }[]
  }
}

export type MediaListCollection = {
  lists: {
    status: string
    entries: {
      media: Media
    }[]
  }[]
}

export type Viewer = {
  avatar: {
    medium: string
    large: string
  }
  name: string
  id: number
  mediaListOptions?: {
    animeList?: {
      customLists?: { name: string; enabled: boolean }[]
    }
  }
}

export type Query<T> = {
  data: T
}

export type PagedQuery<T> = Query<{
  Page: {
    pageInfo: {
      total: number
      perPage: number
      currentPage: number
      lastPage: number
      hasNextPage: boolean
    }
  } & T
}>

// TODO: error responses and nullish values
