/**
 * Load a lazy chunk again after a failed fetch. A dropped or refused request for a code-split
 * chunk would otherwise leave React.lazy holding the rejection, and the panel would never open.
 * Browsers do not cache a failed module fetch, so calling `load` again really re-downloads it.
 */
export function retryImport<T>(load: () => Promise<T>, retries = 2, waitMs = 600): Promise<T> {
  return load().catch((error: unknown) => {
    if (retries <= 0) throw error;
    return new Promise<void>((resolve) => setTimeout(resolve, waitMs)).then(() =>
      retryImport(load, retries - 1, waitMs * 2),
    );
  });
}
