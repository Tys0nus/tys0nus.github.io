import React from 'react';
import { ShaderGradientCanvas, ShaderGradient } from 'shadergradient';
import * as fiber from '@react-three/fiber';
import * as drei from '@react-three/drei';
import * as reactSpring from '@react-spring/three';

function AnimatedBackground() {
  const isLowPowerDevice =
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4);

  const urlString = isLowPowerDevice
    ? 'https://www.shadergradient.co/customize?animate=on&axesHelper=off&bgColor1=%23000000&bgColor2=%23000000&brightness=1.1&cAzimuthAngle=180&cDistance=3.6&cPolarAngle=90&cameraZoom=1&color1=%23ff5005&color2=%23dbba95&color3=%23d0bce1&destination=onCanvas&embedMode=off&envPreset=city&format=gif&fov=45&frameRate=8&gizmoHelper=hide&grain=off&lightType=3d&pixelDensity=1&positionX=-1.4&positionY=0&positionZ=0&range=enabled&rangeEnd=26&rangeStart=0&reflection=0.05&rotationX=0&rotationY=8&rotationZ=40&shader=defaults&toggleAxis=false&type=waterPlane&uAmplitude=0&uDensity=2.1&uFrequency=4.8&uSpeed=0.28&uStrength=0.9&uTime=0&wireframe=false&zoomOut=false'
    : 'https://www.shadergradient.co/customize?animate=on&axesHelper=off&bgColor1=%23000000&bgColor2=%23000000&brightness=1.2&cAzimuthAngle=180&cDistance=3.6&cPolarAngle=90&cameraZoom=1&color1=%23ff5005&color2=%23dbba95&color3=%23d0bce1&destination=onCanvas&embedMode=off&envPreset=city&format=gif&fov=45&frameRate=10&gizmoHelper=hide&grain=on&lightType=3d&pixelDensity=1.3&positionX=-1.4&positionY=0&positionZ=0&range=enabled&rangeEnd=34&rangeStart=0&reflection=0.08&rotationX=0&rotationY=10&rotationZ=50&shader=defaults&toggleAxis=false&type=waterPlane&uAmplitude=0&uDensity=2.3&uFrequency=5.5&uSpeed=0.34&uStrength=1&uTime=0&wireframe=false&zoomOut=false';

  return (
    <ShaderGradientCanvas
      importedFiber={{ ...fiber, ...drei, ...reactSpring }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
      }}
    >
      <ambientLight intensity={0.3} />
      <ShaderGradient control="query" urlString={urlString} />
    </ShaderGradientCanvas>
  );
}

export default AnimatedBackground;
