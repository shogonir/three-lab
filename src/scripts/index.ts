import * as THREE from 'three';

const vertexShaderSource = `
varying vec3 vViewPosition;
varying vec3 vNormal;

varying mat4 vMat;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vViewPosition = -mvPosition.xyz;
  vNormal = normalMatrix * normal;
  vMat = viewMatrix;
}
`;

const fragmentShaderSource = `
varying vec3 vViewPosition;
varying vec3 vNormal;

varying mat4 vMat;

// uniforms
uniform float metallic;
uniform float roughness;
uniform vec3 albedo;

// defines
#define PI 3.14159265359
#define PI2 6.28318530718
#define RECIPROCAL_PI 0.31830988618
#define RECIPROCAL_PI2 0.15915494
#define LOG2 1.442695
#define EPSILON 1e-6

struct IncidentLight {
  vec3 color;
  vec3 direction;
  bool visible;
};

struct ReflectedLight {
  vec3 directDiffuse;
  vec3 directSpecular;
  vec3 indirectDiffuse;
  vec3 indirectSpecular;
};

struct GeometricContext {
  vec3 position;
  vec3 normal;
  vec3 viewDir;
};

struct Material {
  vec3 diffuseColor;
  float specularRoughness;
  vec3 specularColor;
};

// lights

float saturate(float x) {
  return clamp(x, 0.0, 1.0);
}

bool testLightInRange(const in float lightDistance, const in float cutoffDistance) {
  return any(bvec2(cutoffDistance == 0.0, lightDistance < cutoffDistance));
}

float punctualLightIntensityToIrradianceFactor(const in float lightDistance, const in float cutoffDistance, const in float decayExponent) {
  if (decayExponent > 0.0) {
    return pow(saturate(-lightDistance / cutoffDistance + 1.0), decayExponent);
  }
  
  return 1.0;
}

struct DirectionalLight {
  vec3 direction;
  vec3 color;
};

void getDirectionalDirectLightIrradiance(const in DirectionalLight directionalLight, const in GeometricContext geometry, out IncidentLight directLight) {
  directLight.color = directionalLight.color;
  directLight.direction = directionalLight.direction;
  directLight.visible = true;
}

struct PointLight {
  vec3 position;
  vec3 color;
  float distance;
  float decay;
};

void getPointDirectLightIrradiance(const in PointLight pointLight, const in GeometricContext geometry, out IncidentLight directLight) {
  vec3 L = pointLight.position - geometry.position;
  directLight.direction = normalize(L);
  
  float lightDistance = length(L);
  if (testLightInRange(lightDistance, pointLight.distance)) {
    directLight.color = pointLight.color;
    directLight.color *= punctualLightIntensityToIrradianceFactor(lightDistance, pointLight.distance, pointLight.decay);
    directLight.visible = true;
  } else {
    directLight.color = vec3(0.0);
    directLight.visible = false;
  }
}

struct SpotLight {
  vec3 position;
  vec3 direction;
  vec3 color;
  float distance;
  float decay;
  float coneCos;
  float penumbraCos;
};

void getSpotDirectLightIrradiance(const in SpotLight spotLight, const in GeometricContext geometry, out IncidentLight directLight) {
  vec3 L = spotLight.position - geometry.position;
  directLight.direction = normalize(L);
  
  float lightDistance = length(L);
  float angleCos = dot(directLight.direction, spotLight.direction);
  
  if (all(bvec2(angleCos > spotLight.coneCos, testLightInRange(lightDistance, spotLight.distance)))) {
    float spotEffect = smoothstep(spotLight.coneCos, spotLight.penumbraCos, angleCos);
    directLight.color = spotLight.color;
    directLight.color *= spotEffect * punctualLightIntensityToIrradianceFactor(lightDistance, spotLight.distance, spotLight.decay);
    directLight.visible = true;
  } else {
    directLight.color = vec3(0.0);
    directLight.visible = false;
  }
}

// light uniforms
#define LIGHT_MAX 4
// uniform DirectionalLight directionalLights[LIGHT_MAX];
// uniform PointLight pointLights[LIGHT_MAX];
// uniform SpotLight spotLights[LIGHT_MAX];
// uniform int numDirectionalLights;
// uniform int numPointLights;
// uniform int numSpotLights;

// uniform DirectionalLight directionalLights[LIGHT_MAX];
// uniform PointLight pointLights[LIGHT_MAX];
// uniform SpotLight spotLights[LIGHT_MAX];
int numDirectionalLights = 1;
int numPointLights = 0;
int numSpotLights = 0;

// BRDFs

// Normalized Lambert
vec3 DiffuseBRDF(vec3 diffuseColor) {
  return diffuseColor / PI;
}

vec3 F_Schlick(vec3 specularColor, vec3 H, vec3 V) {
  return (specularColor + (1.0 - specularColor) * pow(1.0 - saturate(dot(V,H)), 5.0));
}

float D_GGX(float a, float dotNH) {
  float a2 = a*a;
  float dotNH2 = dotNH*dotNH;
  float d = dotNH2 * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

float G_Smith_Schlick_GGX(float a, float dotNV, float dotNL) {
  float k = a*a*0.5 + EPSILON;
  float gl = dotNL / (dotNL * (1.0 - k) + k);
  float gv = dotNV / (dotNV * (1.0 - k) + k);
  return gl*gv;
}

// Cook-Torrance
vec3 SpecularBRDF(const in IncidentLight directLight, const in GeometricContext geometry, vec3 specularColor, float roughnessFactor) {
  
  vec3 N = geometry.normal;
  vec3 V = geometry.viewDir;
  vec3 L = directLight.direction;
  
  float dotNL = saturate(dot(N,L));
  float dotNV = saturate(dot(N,V));
  vec3 H = normalize(L+V);
  float dotNH = saturate(dot(N,H));
  float dotVH = saturate(dot(V,H));
  float dotLV = saturate(dot(L,V));
  float a = roughnessFactor * roughnessFactor;

  float D = D_GGX(a, dotNH);
  float G = G_Smith_Schlick_GGX(a, dotNV, dotNL);
  vec3 F = F_Schlick(specularColor, V, H);
  return (F*(G*D))/(4.0*dotNL*dotNV+EPSILON);
}

// RenderEquations(RE)
void RE_Direct(const in IncidentLight directLight, const in GeometricContext geometry, const in Material material, inout ReflectedLight reflectedLight) {
  
  float dotNL = saturate(dot(geometry.normal, directLight.direction));
  vec3 irradiance = dotNL * directLight.color;
  
  // punctual light
  irradiance *= PI;
  
  reflectedLight.directDiffuse += irradiance * DiffuseBRDF(material.diffuseColor);
  reflectedLight.directSpecular += irradiance * SpecularBRDF(directLight, geometry, material.specularColor, material.specularRoughness);
}

void main() {
  GeometricContext geometry;
  geometry.position = -vViewPosition;
  geometry.normal = normalize(vNormal);
  geometry.viewDir = normalize(vViewPosition);
  
  Material material;
  material.diffuseColor = mix(albedo, vec3(0.0), metallic);
  material.specularColor = mix(vec3(0.04), albedo, metallic);
  material.specularRoughness = roughness;
  
  // Lighting
  
  ReflectedLight reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
  vec3 emissive = vec3(0.0);
  float opacity = 1.0;
  
  IncidentLight directLight;
  
  // // point light
  // for (int i=0; i<LIGHT_MAX; ++i) {
  //   if (i >= numPointLights) break;
  //   getPointDirectLightIrradiance(pointLights[i], geometry, directLight);
  //   if (directLight.visible) {
  //     RE_Direct(directLight, geometry, material, reflectedLight);
  //   }
  // }
  
  // // spot light
  // for (int i=0; i<LIGHT_MAX; ++i) {
  //   if (i >= numSpotLights) break;
  //   getSpotDirectLightIrradiance(spotLights[i], geometry, directLight);
  //   if (directLight.visible) {
  //     RE_Direct(directLight, geometry, material, reflectedLight);
  //   }
  // }
  
  // directional light
  for (int i=0; i<LIGHT_MAX; ++i) {
    if (i >= numDirectionalLights) break;
    DirectionalLight directionalLight;
    directionalLight.direction = (vMat * vec4(1.0, 1.0, 1.0, 0.0)).xyz;
    directionalLight.color = vec3(1.0, 1.0, 1.0);
    getDirectionalDirectLightIrradiance(directionalLight, geometry, directLight);
    // getDirectionalDirectLightIrradiance(directionalLights[i], geometry, directLight);
    RE_Direct(directLight, geometry, material, reflectedLight);
  }
  
  vec3 outgoingLight = emissive + reflectedLight.directDiffuse + reflectedLight.directSpecular + reflectedLight.indirectDiffuse + reflectedLight.indirectSpecular;
  
  gl_FragColor = vec4(outgoingLight, opacity);
}
`;

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
  const renderer = new THREE.WebGL1Renderer();
  
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
        // const material = new THREE.MeshStandardMaterial({
        //   color: new THREE.Color(1.0, 1.0, 1.0),
        //   metalness: metallic,
        //   roughness: roughness,
        // });
        const uniforms: {[key: string]: THREE.IUniform<any>} = {
          metallic: {value: metallic},
          roughness: {value: roughness},
          albedo: {value: new THREE.Color(1.0, 1.0, 1.0)},
          // pointLights: {value: [
          //   // {
          //   //   position: new THREE.Vector3(0.0, 0.0, 0.0),
          //   //   color: new THREE.Color(1.0, 1.0, 1.0),
          //   //   distance: 1.0,
          //   //   decay: 10.0,
          //   // },
          // ]},
          // spotLights: {value: [
          //   // {
          //   //   position: new THREE.Vector3(0.0, 0.0, 0.0),
          //   //   color: new THREE.Color(1.0, 1.0, 1.0),
          //   //   direction: new THREE.Vector3(0.0, 0.0, 1.0),
          //   //   distance: 1.0,
          //   //   decay: 10.0,
          //   //   coneCos: 0.0,
          //   //   pnumbraCos: 0.0,
          //   // },
          // ]},
          // directionalLights: {value: [
          //   // {
          //   //   direction: new THREE.Vector3(1.0, 1.0, 1.0),
          //   //   color: new THREE.Color(1.0, 1.0, 1.0),
          //   // }
          //   // {
          //   //   direction: {value: new THREE.Vector3(1.0, 1.0, 1.0)},
          //   //   color: {value: new THREE.Color(1.0, 1.0, 1.0)},
          //   // }
          // ]},
          numPointLights: {value: 0},
          numSpotLights: {value: 0},
          numDirectionalLights: {value: 0},
        };
        const material = new THREE.ShaderMaterial({
          uniforms: uniforms,
          vertexShader: vertexShaderSource,
          fragmentShader: fragmentShaderSource,
        })
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
