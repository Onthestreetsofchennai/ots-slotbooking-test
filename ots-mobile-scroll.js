
(function(){
  function isPhoneScrollMode() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 700px), (pointer: coarse)').matches);
  }
  if (!isPhoneScrollMode()) return;

  var endTimer = null;
  var active = false;
  function startNativeScroll() {
    if (!active) {
      document.body.classList.add('ots-native-scrolling');
      active = true;
    }
    clearTimeout(endTimer);
    endTimer = setTimeout(stopNativeScroll, 180);
  }
  function stopNativeScroll() {
    clearTimeout(endTimer);
    document.body.classList.remove('ots-native-scrolling');
    active = false;
  }

  window.addEventListener('scroll', startNativeScroll, { passive:true });
  window.addEventListener('touchmove', startNativeScroll, { passive:true });
  window.addEventListener('touchend', function(){
    clearTimeout(endTimer);
    endTimer = setTimeout(stopNativeScroll, 140);
  }, { passive:true });
  window.addEventListener('touchcancel', stopNativeScroll, { passive:true });
})();