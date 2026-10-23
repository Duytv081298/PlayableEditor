// Chuẩn bị HTML để chơi thử trong iframe: gắn bộ bắt log + giả lập SDK network
import type { SimKind } from './channels';

export const PREVIEW_MSG = '__playable_editor__';

const SIM_CODE: Record<SimKind, string> = {
  none: '',
  mraid: `
var L={},st="loading";
window.mraid={
 getState:function(){return st},isViewable:function(){return st!=="loading"},
 addEventListener:function(e,f){(L[e]=L[e]||[]).push(f)},removeEventListener:function(e,f){L[e]=(L[e]||[]).filter(function(x){return x!==f})},
 open:function(u){cta("mraid.open",u)},close:function(){info("mraid.close()")},expand:function(){},useCustomClose:function(){},
 getVersion:function(){return"3.0"},getPlacementType:function(){return"interstitial"},getAudioVolume:function(){return 1},
 supports:function(){return false},getScreenSize:function(){return{width:innerWidth,height:innerHeight}},getMaxSize:function(){return{width:innerWidth,height:innerHeight}}
};
function fire(e,a){(L[e]||[]).slice().forEach(function(f){try{f(a)}catch(x){console.error(x)}})}
var _alive=true;window.addEventListener("pagehide",function(){_alive=false});
setTimeout(function(){if(!_alive)return;st="default";info("mraid ready");fire("ready");setTimeout(function(){if(!_alive)return;info("mraid viewableChange(true)");fire("viewableChange",true)},50)},150);`,
  facebook: `window.FbPlayableAd={onCTAClick:function(){cta("FbPlayableAd.onCTAClick")}};`,
  google: `window.ExitApi={exit:function(){cta("ExitApi.exit")}};`,
  mintegral: `window.install=function(){cta("window.install")};
window.gameReady=function(){info("mintegral: gameReady() -> gọi gameStart()");setTimeout(function(){window.gameStart&&window.gameStart()},50)};
window.gameEnd=function(){info("mintegral: gameEnd()")};`,
  pangle: `window.openAppStore=function(){cta("openAppStore")};window.playableSDK={openAppStore:function(){cta("playableSDK.openAppStore")}};`,
  vungle: ``,
  dapi: `var DL={};window.dapi={isReady:function(){return true},addEventListener:function(e,f){DL[e]=f},removeEventListener:function(e){delete DL[e]},
 getScreenSize:function(){return{width:innerWidth,height:innerHeight}},getAudioVolume:function(){return 100},isViewable:function(){return true},
 openStoreUrl:function(){cta("dapi.openStoreUrl")}};`,
  snapchat: `window.ScPlayableAd={onCTAClick:function(){cta("ScPlayableAd.onCTAClick")}};`,
  kwai: `window.ks_playable_openAppStore=function(){cta("ks_playable_openAppStore")};window.ks_playable_startPlay=function(){info("kwai startPlay")};window.ks_playable_exposurePage=function(){};`,
  bigo: `window.BGY_MRAID={open:function(){cta("BGY_MRAID.open")},gameReady:function(){info("bigo: gameReady()")},gameEnd:function(){info("bigo: gameEnd()")}};`,
  gdt: `window.GDTUnSdk=function(){this.playAble={onClick:function(){cta("_gdtUnSdk.playAble.onClick")}}};`,
  yandex: `window.yandexHTML5BannerApi={getClickURLNum:function(n){cta("yandexHTML5BannerApi.getClickURLNum("+n+")");return""}};`,
};

function shim(sim: SimKind, label: string): string {
  return `<script>(function(){
var post=function(t,m){try{parent.postMessage({${PREVIEW_MSG}:1,type:t,msg:m},"*")}catch(e){}};
var fmt=function(a){if(typeof a==="string")return a;if(a instanceof Error)return a.stack||a.message;try{return JSON.stringify(a)}catch(e){return String(a)}};
["log","info","warn","error","debug"].forEach(function(k){var o=console[k];console[k]=function(){try{post(k,[].map.call(arguments,fmt).join(" "))}catch(e){}return o.apply(console,arguments)}});
window.addEventListener("error",function(e){post("error",(e.message||"Error")+(e.filename?" @"+e.filename.split("/").pop()+":"+e.lineno:""))});
window.addEventListener("unhandledrejection",function(e){post("error","Promise: "+fmt(e.reason))});
var info=function(m){post("sim",m)};
var cta=function(api,u){
  var dest = u || (window.super_html && (window.super_html.google_play_url || window.super_html.appstore_url)) || (window.__PLAYABLE_STORE_URLS__ && (window.__PLAYABLE_STORE_URLS__.googlePlay || window.__PLAYABLE_STORE_URLS__.appStore));
  post("cta",api+(dest?" → "+dest:""));
};
window.open=function(u){cta("window.open",u);return null};
${SIM_CODE[sim]}
info(${JSON.stringify('Giả lập: ' + label)});
})();</script>`;
}

/** Gỡ script SDK bên ngoài để mock có hiệu lực, chèn shim lên đầu <head> */
export function makePreviewHtml(html: string, sim: SimKind, label: string): string {
  let out = html
    .replace(/<script[^>]*\ssrc=["']https?:\/\/[^"']*(googlesyndication|ibytedtos|gdtimg|kwai\.net|likeevideo)[^"']*["'][^>]*>\s*<\/script>/gi, '<!-- SDK removed for preview -->')
    .replace(/<script[^>]*\ssrc=["']mraid\.js["'][^>]*>\s*<\/script>/gi, '<!-- mraid.js removed for preview -->');
  const s = shim(sim, label);
  const head = out.match(/<head[^>]*>/i);
  if (head) out = out.slice(0, head.index! + head[0].length) + s + out.slice(head.index! + head[0].length);
  else out = s + out;
  return out;
}
