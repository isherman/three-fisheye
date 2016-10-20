const THREE = require("three");
const OrbitControls = require('three-orbitcontrols');
const $     = require("jquery");
const Stats = require("stats.js");
window.THREE = THREE;
window.$ = $;

function load_video(url) {
  const video = document.createElement("video");
  return new Promise((resolve, reject)=>{
    video.src = url;
    video.addEventListener("loadeddata", function listener(){
      video.removeEventListener("loadeddata", listener);
      resolve( video );
    });
  });
}

function load_video_texture(url) {
  return load_video(url).then((video)=>{
    video.loop = true;
    video.play();
    return new THREE.VideoTexture( video );
  });
}

function load_texture(url) {
  return new Promise((resolve, reject)=>{
    const loader = new THREE.TextureLoader();
    loader.load(url, resolve, (xhr) => {}, reject );
  });
}

function load_skybox_texture(urls){
  return new Promise((resolve, reject)=>{
    const loader = new THREE.CubeTextureLoader();
    loader.setPath(urls);
    loader.load( [
      'px.jpg', 'nx.jpg',
      'py.jpg', 'ny.jpg',
      'pz.jpg', 'nz.jpg'
    ], resolve, (xhr) => {}, reject );
  });
}


function load_clipped_video_canvas_texture(url){
  return load_video(url).then((video)=>{
    const cnv = document.createElement("canvas");
    const ctx = cnv.getContext("2d");
    const {videoWidth, videoHeight} = video;
    const min = Math.min(videoWidth, videoHeight);
    const max = Math.max(videoWidth, videoHeight);
    for(var i=0; min > Math.pow(2, i); i++); // 2^n の大きさを得る
    let pow = Math.pow(2, i-1);
    const [dx, dy, dw, dh] = [0, 0, pow, pow]; // 縮小先の大きさ
    const [sx, sy, sw, sh] = videoWidth < videoHeight ? [0, (max/2)-(min/2), min, min] // ソースのクリッピング領域
                                                      : [(max/2)-(min/2), 0, min, min];
    cnv.width = cnv.height = pow;
    const tex = new THREE.Texture(cnv);
    let paused = false;
    video.addEventListener("playing", (ev)=>{ paused = false; requestAnimationFrame(_draw) });
    video.addEventListener("pause", (ev)=>{ paused = true; });
    video.addEventListener("ended", (ev)=>{ paused = true; });
    function _draw(){
      cnv.width = cnv.width;
      ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
      tex.needsUpdate = true;
      if(!paused) requestAnimationFrame(_draw);
    }
    video.loop = true;
    video.play();
    _draw(); // clipping draw loop start
    return tex;
  });
}

function createSkyboxMesh(skybox_texture){
  const cubeShader = THREE.ShaderLib[ 'cube' ];
  cubeShader.uniforms[ 'tCube' ].value = skybox_texture;
  const skyBoxMaterial = new THREE.ShaderMaterial({
    fragmentShader: cubeShader.fragmentShader,
    vertexShader: cubeShader.vertexShader,
    uniforms: cubeShader.uniforms,
    depthWrite: false,
    side: THREE.BackSide
  });
  // BoxGeometry(width, height, depth, widthSegments, heightSegments, depthSegments)
  const skybox = new THREE.Mesh( new THREE.BoxGeometry( 3000, 3000, 3000, 1, 1, 1 ), skyBoxMaterial);
  return skybox;
}

function createFisheyeMesh(fisheye_texture){ // 正方形テクスチャを仮定
  // SphereGeometry(radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength)
  const 球体 = new THREE.SphereGeometry(800, 16, 16, 0, Math.PI);
  const {vertices, faces, faceVertexUvs} = 球体;
  const radius = 球体.boundingSphere.radius;
  // 半球の正射影をとる
  faces.forEach((face, i)=>{
    const {a, b, c} = face;
    faceVertexUvs[0][i] = [a, b, c].map((id)=>{
      const {x, y} = vertices[id];
      return new THREE.Vector2(
        (x+radius)/(2*radius),
        (y+radius)/(2*radius));
    });
  });
  const mat = new THREE.MeshBasicMaterial( { color: 0xFFFFFF, map: fisheye_texture, side: THREE.BackSide } );
  const 完全な白い球体 = new THREE.Mesh(球体, mat);
  完全な白い球体.rotation.x = Math.PI*3/2; // 北緯側の半球になるように回転
  return 完全な白い球体;
}

function createPanoramaMesh(fisheye_texture){ // 正方形テクスチャを仮定
  const R1_ratio = 0; // 扇型の下弦 0~1
  const R2_ratio = 1; // 扇型の上弦 0~1 下弦 < 上弦
  const h_per_w_ratio = (()=>{
    // fisheye -> panorama のパノラマのw/hアスペクト比を計算
    const {width, height} = fisheye_texture.image;
    const [Hs, Ws] = [width, height]; // fisheye 画像短径
    const [Cx, Cy] = [Ws/2, Hs/2]; // fisheye 中心座標
    const R = Hs/2; // 中心座標からの半径
    const [R1, R2] = [R*R1_ratio, R*R2_ratio]; // fisheye から ドーナッツ状に切り取る領域を決める半径二つ
    const [Wd, Hd] = [(R2 + R1)*Math.PI, R2 - R1] // ドーナッツ状に切り取った領域を短径に変換した大きさ
    return Hd/Wd;
  })();
  const panorama_width = 400;
  const モノリス = new THREE.PlaneGeometry(panorama_width, panorama_width*h_per_w_ratio, 32, 32);
  const {vertices, faces, faceVertexUvs} = モノリス;
  // UVを扇型に変換
  const [Hs, Ws] = [1, 1]; // UV のサイズ
  const [Cx, Cy] = [Ws/2, Hs/2]; // UV の中心座標
  const R = Hs/2; // 中心座標からの半径
  const [R1, R2] = [R*R1_ratio, R*R2_ratio]; // UV からドーナッツ状に切り取る領域を決める半径二つ
  const [Wd, Hd] = [1, 1] // ドーナッツ状に切り取った領域を短径に変換した大きさ
  faceVertexUvs[0] = faceVertexUvs[0].map((pt2Dx3)=>{
    return pt2Dx3.map(({x, y})=>{
      const [xD, yD] = [x, y];
      const r = (yD/Hd)*(R2-R1) + R1;
      const theta = (xD/Wd)*2.0*Math.PI;
      const xS = Cx + r*Math.sin(theta);
      const yS = Cy + r*Math.cos(theta);
      return new THREE.Vector2(xS, yS);
    });
  });
  const mat = new THREE.MeshBasicMaterial( { color: 0xFFFFFF, map: fisheye_texture } );
  const 漆黒のモノリス = new THREE.Mesh(モノリス, mat);
  漆黒のモノリス.rotation.x = Math.PI; // 北緯側の半球になるように回転
  漆黒のモノリス.rotation.y = Math.PI; // こっちむいてベイビー
  漆黒のモノリス.position.z = -panorama_width; // カメラからの距離
  return 漆黒のモノリス;
}

function create_camera(type){
  const camera = type === "orthographic"
    // 画角, アスペクト比、視程近距離、視程遠距離
    ? new THREE.OrthographicCamera(window.innerWidth/-2, window.innerWidth/2, window.innerHeight/2, window.innerHeight/-2, 1, 10000)
    // left, right, top, bottom, near, far
    : new THREE.PerspectiveCamera( 40, window.innerWidth / window.innerHeight, 1, 10000 );
  camera.position.z = 0.01;

  return camera;
}

function main(){
  const container = document.body;

  const stats = new Stats();
  stats.showPanel( 0 ); // FPS測る
  container.appendChild( stats.dom );

  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // 素材ロード
  Promise.all([
    // カメラをひとつ選択
      //create_camera("perspective"),
      create_camera("orthographic"),
    // 空をひとつ選択
      load_skybox_texture('textures/cube/Park3Med/').then(createSkyboxMesh), // 夜の住宅街
      //load_skybox_texture('textures/cube/SwedishRoyalCastle/').then(createSkyboxMesh), // 夜のお城
      //load_skybox_texture('textures/cube/skybox/').then(createSkyboxMesh), // 空
    // 魚眼素材と表示方法をひとつ選択
      //load_video_texture("./2016-10-18-123529.webm").then(createFisheyeMesh), // 補正なし魚眼静止画 → 天球
      //load_clipped_video_canvas_texture("./2016-10-18-123529.webm").then(createFisheyeMesh), // 魚眼動画 → 天球
      //load_texture("./2016-10-18-16.29.01.png").then(createFisheyeMesh), // 魚眼静止画 → 天球
      //load_texture("./2016-10-18-16.29.01.png").then(createPanoramaMesh), // 魚眼静止画 → パノラマ
      load_clipped_video_canvas_texture("./2016-10-18-123529.webm").then(createPanoramaMesh) // 魚眼動画 → パノラマ
  ]).then(([camera, skybox, mesh])=>{
    console.log(mesh)
    // カメラポーズのコントローラ
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.enableZoom = false;

    // 全画面表示のリサイズに応じて画角調整
    window.addEventListener('resize', function() {
      if(camera instanceof THREE.PerspectiveCamera){
        camera.aspect = window.innerWidth / window.innerHeight;
      }else if(camera instanceof THREE.OrthographicCamera){
        camera.left = window.innerWidth/-2;
        camera.right = window.innerWidth/2;
        camera.top = window.innerHeight/2;
        camera.bottom = window.innerHeight/-2;
      }
      camera.updateProjectionMatrix();
      renderer.setSize( window.innerWidth, window.innerHeight );
    }, false);

    scene.add(camera);
    scene.add(skybox);
    scene.add(mesh);
    
    // レンダリングループ
    function _loop(){
      stats.begin();

      // カメラポーズ更新
      controls.update();
      renderer.render(scene, camera);

      stats.end();
      requestAnimationFrame(_loop);
    }

    requestAnimationFrame(_loop);
  })
  .catch(console.error.bind(console));
}


$(main);
