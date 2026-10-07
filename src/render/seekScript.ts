// Shared "virtual clock" seek contract for overlay/b-roll HTML pages.
// See render/README.md for the authoring contract this implements.
export function seekExpr(t: number): string {
  return `(function(t){
    if (typeof window.renderFrame === 'function') { window.renderFrame(t); return 'renderFrame'; }
    if (typeof window.__seek === 'function') { window.__seek(t); return '__seek'; }
    var anims = (document.getAnimations ? document.getAnimations() : []);
    anims.forEach(function(a){ try { a.pause(); a.currentTime = t * 1000; } catch (e) {} });
    return 'animations:' + anims.length;
  })(${t})`;
}

export const READY_EXPR = `Promise.all([
  (document.fonts ? document.fonts.ready.then(function(){return true;}) : Promise.resolve(true)),
  Promise.all(Array.from(document.images).map(function(img){
    if (typeof img.decode === 'function') return img.decode().catch(function(){});
    if (img.complete) return Promise.resolve();
    return new Promise(function(resolve){
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  }))
]).then(function(){ return true; })`;

export const DOUBLE_RAF_EXPR = `new Promise(function(resolve){
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ resolve(true); }); });
})`;
