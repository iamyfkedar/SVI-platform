export function mask2Angle(maskArray, width, rotation){
    let maxVal = Math.max(...maskArray.map(item => item[0]));
    let minVal = Math.min(...maskArray.map(item => item[0]));
    let midDegree = (minVal + maxVal) / 2 / width * 360 - 180;
    let minDegree = minVal / width * 360 - 180;
    let maxDegree = maxVal / width * 360 - 180;
    let heading = (540 - rotation) % 360; // 转为正北为0，顺时针方向
    let viewAngle = heading + midDegree; // 视角方向 
    let minViewAngle = heading + minDegree;
    let maxViewAngle = heading + maxDegree;
}