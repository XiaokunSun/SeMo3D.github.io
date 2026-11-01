// Comparison clips share playback phase and pause automatically off screen.
window.SeMoMediaController = function ({ videos, allVideos = videos, visible }) {
  const duration = video => Number.isFinite(video?.duration) && video.duration > 0 ? video.duration : 0;
  function sync(restart = false) {
    const active = videos();
    const canPlay = visible() && !document.hidden;
    for (const video of allVideos()) {
      if (active.includes(video) && visible()) {
        if (!video.getAttribute('src') && video.dataset.src) { video.src = video.dataset.src; video.preload = 'auto'; }
        if (restart) video.currentTime = 0;
        if (canPlay) video.play().catch(() => {});
        else video.pause();
      } else video.pause();
    }
  }
  for (const video of allVideos()) {
    video.addEventListener('loadedmetadata', () => {
      if (!videos().includes(video)) return;
      const master = videos()[0], length = duration(video), masterLength = duration(master);
      if (length && masterLength) video.currentTime = Math.min(length - .001, master.currentTime / masterLength * length);
    });
    video.addEventListener('timeupdate', () => {
      const active = videos(), length = duration(video);
      if (video !== active[0] || !length || !visible()) return;
      const phase = video.currentTime / length;
      for (const other of active.slice(1)) {
        const otherLength = duration(other);
        if (otherLength && Math.abs(other.currentTime - phase * otherLength) > .16) other.currentTime = phase * otherLength;
        if (otherLength) other.playbackRate = otherLength / length;
      }
    });
  }
  document.addEventListener('visibilitychange', () => sync());
  return { sync };
};
