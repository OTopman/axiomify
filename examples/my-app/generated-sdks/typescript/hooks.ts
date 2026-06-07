import { useQuery, useMutation, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import { ApiClient } from './client';
import type * as Types from './types';

export class ApiHooks {
  constructor(private client: ApiClient) {}

  useGetMetrics(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getMetrics"],
      queryFn: () => this.client.getMetrics(),
      ...options,
    });
  }

  useGetAssetsAll(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getAssetsAll"],
      queryFn: () => this.client.getAssetsAll(),
      ...options,
    });
  }

  useGetApiUsers(options?: Omit<UseQueryOptions<Types.GetApiUsersResponse, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getApiUsers"],
      queryFn: () => this.client.getApiUsers(),
      ...options,
    });
  }

  usePostApiUsers(options?: UseMutationOptions<void, Error, { body: Types.PostApiUsersRequest }>) {
    return useMutation({
      mutationFn: (req) => this.client.postApiUsers(req),
      ...options,
    });
  }

  usePostApiUsersAvatar(options?: UseMutationOptions<void, Error, { body: Types.PostApiUsersAvatarRequest }>) {
    return useMutation({
      mutationFn: (req) => this.client.postApiUsersAvatar(req),
      ...options,
    });
  }

  usePostGraphql(options?: UseMutationOptions<void, Error, void>) {
    return useMutation({
      mutationFn: () => this.client.postGraphql(),
      ...options,
    });
  }

  useGetGraphql(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getGraphql"],
      queryFn: () => this.client.getGraphql(),
      ...options,
    });
  }

  useGetGraphqlPlayground(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getGraphqlPlayground"],
      queryFn: () => this.client.getGraphqlPlayground(),
      ...options,
    });
  }

  useGetApiSecureData(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getApiSecureData"],
      queryFn: () => this.client.getApiSecureData(),
      ...options,
    });
  }

  useGetProtectedData(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getProtectedData"],
      queryFn: () => this.client.getProtectedData(),
      ...options,
    });
  }

  useGetPing(options?: Omit<UseQueryOptions<Types.GetPingResponse, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getPing"],
      queryFn: () => this.client.getPing(),
      ...options,
    });
  }

  useGetApiLogin(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getApiLogin"],
      queryFn: () => this.client.getApiLogin(),
      ...options,
    });
  }

  useGetDownload(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getDownload"],
      queryFn: () => this.client.getDownload(),
      ...options,
    });
  }

  useGetLiveFeed(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getLiveFeed"],
      queryFn: () => this.client.getLiveFeed(),
      ...options,
    });
  }

  useGetDocsOpenapiJson(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getDocsOpenapiJson"],
      queryFn: () => this.client.getDocsOpenapiJson(),
      ...options,
    });
  }

  useGetDocs(options?: Omit<UseQueryOptions<void, Error>, 'queryKey' | 'queryFn'>) {
    return useQuery({
      queryKey: ["getDocs"],
      queryFn: () => this.client.getDocs(),
      ...options,
    });
  }
}
