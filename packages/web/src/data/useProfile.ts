import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Profile } from '@fastr/shared';
import { fetchProfile, profileQueryKey, updateProfile, type ProfilePatch } from './profile.js';

/**
 * The profile, and one way to change it.
 *
 * Every screen that writes a setting goes through `save` here rather than calling `updateProfile`
 * directly, so invalidation happens in one place. A screen that writes and forgets to invalidate leaves
 * the rest of the app showing the old value until something else happens to refetch, which looks like the
 * save failed.
 */

export function useProfile() {
  return useQuery({ queryKey: profileQueryKey, queryFn: fetchProfile });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: ProfilePatch) => updateProfile(patch),

    /**
     * Applied to the cache before the server answers, and rolled back if it fails.
     *
     * Worth the complexity for exactly one of these fields: the theme. A toggle that waits for a round
     * trip before recolouring feels broken, and on a phone on mobile data that is half a second of a
     * switch that appears stuck. The rest of the settings inherit it because treating one field
     * differently would be more code, not less.
     */
    onMutate: async (patch: ProfilePatch) => {
      await queryClient.cancelQueries({ queryKey: profileQueryKey });
      const previous = queryClient.getQueryData<Profile | null>(profileQueryKey);

      if (previous) {
        queryClient.setQueryData<Profile>(profileQueryKey, {
          ...previous,
          ...patchToProfile(patch),
        });
      }

      return { previous };
    },

    onError: (_error, _patch, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(profileQueryKey, context.previous);
      }
    },

    // Refetched on success as well as on failure: the server may have normalised something, and the
    // optimistic value is a guess until it agrees.
    onSettled: () => queryClient.invalidateQueries({ queryKey: profileQueryKey }),
  });
}

/** Translates a database patch back into domain spelling, for the optimistic update. */
function patchToProfile(patch: ProfilePatch): Partial<Profile> {
  const next: Partial<Profile> = {};
  if (patch.display_name !== undefined) next.displayName = patch.display_name;
  if (patch.time_zone !== undefined) next.timeZone = patch.time_zone;
  if (patch.weight_unit !== undefined) next.weightUnit = patch.weight_unit;
  if (patch.volume_unit !== undefined) next.volumeUnit = patch.volume_unit;
  if (patch.theme !== undefined) next.theme = patch.theme;
  if (patch.default_plan_id !== undefined) next.defaultPlanId = patch.default_plan_id;
  if (patch.custom_goal_minutes !== undefined) next.customGoalMinutes = patch.custom_goal_minutes;
  if (patch.water_goal_ml !== undefined) next.waterGoalMl = patch.water_goal_ml;
  if (patch.notify_goal !== undefined) next.notifyGoal = patch.notify_goal;
  if (patch.notify_stages !== undefined) next.notifyStages = patch.notify_stages;
  if (patch.notify_hour_before !== undefined) next.notifyHourBefore = patch.notify_hour_before;
  if (patch.health_notice_at !== undefined) next.healthNoticeAt = patch.health_notice_at;
  return next;
}
