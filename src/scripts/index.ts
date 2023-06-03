import * as THREE from 'three';

type PolarCoordinate3 = {
  phi: number;
  theta: number;
  radius: number;
};

const deg2rad = Math.PI / 180.0;
const piHalf = Math.PI / 2.0;
const origin3 = new THREE.Vector3(0.0, 0.0, 0.0);

const setCameraPositionWithPolar = (polar: PolarCoordinate3, camera: THREE.PerspectiveCamera): void => {
  const sinTheta = Math.sin(polar.theta);
  const cosTheta = Math.cos(polar.theta);
  camera.position.x = polar.radius * sinTheta * Math.cos(polar.phi);
  camera.position.y = polar.radius * sinTheta * Math.sin(polar.phi);
  camera.position.z = polar.radius * cosTheta;
  camera.lookAt(origin3);
  camera.up.set(
    -1.0 * cosTheta * Math.cos(polar.phi),
    -1.0 * cosTheta * Math.sin(polar.phi),
    sinTheta,
  );
};

window.onload = () => {
  
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer();
  
  renderer.setClearColor(new THREE.Color(1.0, 1.0, 1.0));

  const area = document.querySelector('#canvas-area');
  if (!area) {
    return;
  }

  const width = area.clientWidth;
  const height = area.clientHeight;

  renderer.setSize(width, height);
  area.appendChild(renderer.domElement);
  
  const camera = new THREE.PerspectiveCamera(90, width / height, 0.1, 2.0);
  
  const polar: PolarCoordinate3 = {
    phi: -90 * deg2rad,
    theta: 60 * deg2rad,
    radius: 1.0,
  };

  setCameraPositionWithPolar(polar, camera);

  let isMouseDown: boolean = false;
  area.addEventListener('mousedown', () => {
    isMouseDown = true;
  });
  area.addEventListener('mouseup', () => {
    isMouseDown = false;
  });
  area.addEventListener('mousemove', (event: Event) => {
    if (!isMouseDown) {
      return;
    }
    const mouseEvent = event as MouseEvent;
    polar.phi -= 0.002 * mouseEvent.movementX;
    polar.theta -= 0.002 * mouseEvent.movementY;
    setCameraPositionWithPolar(polar, camera);
    renderer.render(scene, camera);
  });

  renderer.render(scene, camera);

  // {
  //   const grid = new THREE.GridHelper(10, 10);
  //   scene.add(grid);
  // }

  {
    for (const metallic of [0.1, 0.5, 0.9]) {
      for (const roughness of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const geometry = new THREE.SphereGeometry(1.0, 30, 30);
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(1.0, 1.0, 1.0),
          metalness: metallic,
          roughness: roughness,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const scale = 0.07;
        mesh.scale.set(scale, scale, scale);
        mesh.position.set(roughness - 0.5, metallic - 0.5, 0.0);
        scene.add(mesh);
      }
    }
  }

  {
    const light = new THREE.DirectionalLight(0xFFFFFF, 1.0);
    light.position.set(-10.0, -10.0, 100.0);
    light.lookAt(light.position.sub(new THREE.Vector3(1.0, 1.0, 1.0)));
    scene.add(light);
  }

  renderer.render(scene, camera);

};
