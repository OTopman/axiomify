export type GetApiUsersResponse = any[];

export interface PostApiUsersRequest {
  /**
   * The new username
   */
  username: string;
  /**
   * The user role
   */
  role: any;
}

export interface PostApiUsersAvatarRequest {
  userId: string;
}

export interface PostApiCheckoutRequest {
  email: string;
  name: string;
  amount: number;
  simulateFailure: boolean;
}

export interface GetPingResponse {
  message: string;
}

