import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CompletedFast } from '@fastr/shared';
import {
  activeFastQueryKey,
  addPastFast,
  deleteFast,
  editFast,
  fastHistoryQueryKey,
  fetchFastHistory,
  type AddPastFastInput,
  type EditFastInput,
} from './fasts.js';

export const HISTORY_PAGE_SIZE = 25;

/**
 * Finished fasts, a page at a time. Requirement 9.5.
 *
 * Keyset pagination on `ended_at` rather than offset. An offset re-reads and re-sorts every row it skips, and
 * shifts underneath you when a row is added while paging — so the same fast can appear on two pages or be
 * missed entirely.
 *
 * The cursor is the last row's `ended_at`. Two fasts cannot share one, because they cannot overlap.
 */
export function useFastHistory() {
  return useInfiniteQuery({
    queryKey: fastHistoryQueryKey,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchFastHistory({ before: pageParam, limit: HISTORY_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: CompletedFast[]) =>
      // A short page means the end. Returning a cursor anyway would offer a "load more" that fetches nothing.
      lastPage.length < HISTORY_PAGE_SIZE ? undefined : lastPage.at(-1)?.endedAt,
  });
}

/** Every mutation here invalidates both the history and the active fast, since an edit can affect either. */
function useHistoryMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fastHistoryQueryKey }),
        queryClient.invalidateQueries({ queryKey: activeFastQueryKey }),
      ]);
    },
  });
}

export function useEditFast() {
  return useHistoryMutation((input: EditFastInput) => editFast(input));
}

export function useDeleteFast() {
  return useHistoryMutation((id: string) => deleteFast(id));
}

/** Requirement 9.4. */
export function useAddPastFast() {
  return useHistoryMutation((input: AddPastFastInput) => addPastFast(input));
}
