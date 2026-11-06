(function (root) {
  'use strict';
  // Anchors follow the actual platforms/bridges in each 852 × 1846 illustration,
  // ordered along the route from the foreground towards the destination.
  const maps = [
    ['file_0000000010088210bec1a86f70df189a.png', [[35,82.7],[53,72.7],[77.5,61.8],[57,50.4],[40,40.0]]],
    ['file_00000000117481f5b5e54d54b4daae0d.png', [[72,89.5],[38,74.8],[61,58.3],[34,40.5],[37,28.0]]],
    ['file_00000000592c81f48e55b8f80b387ab1.png', [[35,76.7],[58.5,66.6],[80,57.0],[56.5,48.3],[45,34.6]]],
    ['file_000000005a4081f4996c671f624baa64.png', [[70,80.8],[63,70.3],[74,56.0],[38,46.6],[25,32.0]]],
    ['file_000000006c288210890a5e6d9e788e9a.png', [[80,78.2],[77,57.7],[50,46.9],[25,36.5],[62.5,25.8]]],
    ['file_000000007b44821190697693273e7cc1.png', [[55,86.9],[66.5,75.5],[30,62.5],[64.5,46.7],[34.5,39.0]]],
    ['file_00000000895082119a61be10647d0eff.png', [[71,83.5],[38,68.6],[79.5,55.0],[61.5,47.7],[27.5,33.5]]],
    ['file_000000009dc481f5834b2be2ad8f595e.png', [[68,83.0],[49,70.5],[78,60.0],[58.5,50.7],[43,39.1]]],
    ['file_00000000ad1481f4b2f9e8ed135f6643.png', [[75,87.5],[35,72.2],[56,63.5],[57,47.0],[29,37.8]]],
    ['file_00000000ae2c81f583d012e3b451a436.png', [[67,88.4],[38,67.6],[61,57.9],[58,42.1],[28,33.3]]],
    ['file_00000000d33881f49f0ab5df09bd7005.png', [[29,87.0],[50.5,77.5],[72,60.2],[43.5,49.0],[40.5,35.4]]],
    ['file_00000000eac081f496d850cf23680574.png', [[32,80.0],[70,63.5],[62,54.0],[38,43.7],[78,27.4]]]
  ];
  function forChapter(chapter) {
    const [art, points] = maps[chapter % maps.length];
    return { art, checkpoints: points.map(([x,y]) => ({x,y,labelSide:x >= 50 ? 'left' : 'right'})) };
  }
  function alignCompanion(stage) {
    const owl = stage.querySelector('.map-owl-companion');
    if (!owl || !stage.clientWidth || !stage.clientHeight) return;
    const marker = owl.closest('.node'), frame = stage.getBoundingClientRect(), node = marker.getBoundingClientRect();
    const gap = 12;
    const x = node.left - frame.left, y = node.top - frame.top, cx = x + node.width/2, cy = y + node.height/2;
    const obstacles = [...stage.querySelectorAll('.node,.checkpoint-label,.map-marker-state')].map(element => {
      const r = element.getBoundingClientRect();return {x:r.left-frame.left,y:r.top-frame.top,w:r.width,h:r.height};
    });
    const otherBadges = [...stage.querySelectorAll('.node')].filter(element=>element!==marker).map(element=>{
      const r=element.getBoundingClientRect();return {x:r.left-frame.left+r.width/2,y:r.top-frame.top+r.height/2};
    });
    function findSpot() {
      const width=owl.offsetWidth,height=owl.offsetHeight;
      const distance=([left,top])=>Math.hypot(left+width/2-cx,top+height/2-cy);
      const fits = ([left,top]) => left >= 6 && top >= 6 && left+width <= frame.width-6 && top+height <= frame.height-6 && distance([left,top])<=96 &&
        obstacles.every(r => left+width+4 <= r.x || left >= r.x+r.w+4 || top+height+4 <= r.y || top >= r.y+r.h+4) &&
        otherBadges.every(r=>Math.hypot(left+width/2-r.x,top+height/2-r.y)>distance([left,top])+4);
      const candidates = [
        [cx-width/2,y-height-gap], [cx-width/2,y+node.height+gap],
        [x-width-gap,cy-height/2], [x+node.width+gap,cy-height/2],
        [x-width/2,y-height-gap], [x+node.width-width/2,y-height-gap],
        [x-width/2,y+node.height+gap], [x+node.width-width/2,y+node.height+gap]
      ];
      const direct=candidates.find(fits);if(direct)return direct;
      // Search only the current checkpoint's neighbourhood. The owl must never
      // appear to accompany a different level just to avoid a long caption.
      const free=[];
      for(let top=Math.max(6,cy-96-height/2);top+height<=Math.min(frame.height-6,cy+96+height/2);top+=6) {
        for(let left=Math.max(6,cx-96-width/2);left+width<=Math.min(frame.width-6,cx+96+width/2);left+=6) {
          if(fits([left,top]))free.push([left,top]);
        }
      }
      free.sort((a,b)=>distance(a)-distance(b));return free[0];
    }
    owl.dataset.compact='false';
    let spot=findSpot();
    if(!spot){owl.dataset.compact='true';spot=findSpot();}
    if (spot) { owl.style.left = (spot[0]-x)+'px';owl.style.top = (spot[1]-y)+'px'; }
  }
  function observe(stage) {
    let frame;
    const update = () => { cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>alignCompanion(stage)); };
    if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(stage);
    else root.addEventListener('resize',update);
    document.fonts?.ready.then(update);
    return update;
  }
  root.AdventureMapLayouts = {forChapter,alignCompanion,observe};
})(globalThis);
