const fs = require('fs').promises;
const path = require('path');

let onnx;
let sharp;

class CaptchaSolver {
  constructor() {
    this.session = null;
    this.metadata = null;
    this.modelPath = path.join(__dirname, '..', 'model', 'captcha_model.onnx');
    this.metadataPath = path.join(__dirname, '..', 'model', 'captcha_model_metadata.json');
  }

  async ensureReady() {
    if (!onnx) onnx = require('onnxruntime-node');
    if (!sharp) sharp = require('sharp');

    if (this.session && this.metadata) return;

    this.session = await onnx.InferenceSession.create(this.modelPath);
    this.metadata = JSON.parse(await fs.readFile(this.metadataPath, 'utf8'));
  }

  async solve(imageBuffer) {
    await this.ensureReady();

    const [channels, height, width] = this.metadata.input_shape;
    const processedBuffer = await sharp(imageBuffer)
      .resize(width, height, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    const imageData = new Float32Array(processedBuffer.length);
    const mean = this.metadata.normalization.mean[0];
    const std = this.metadata.normalization.std[0];

    for (let index = 0; index < processedBuffer.length; index++) {
      imageData[index] = (processedBuffer[index] / 255.0 - mean) / std;
    }

    const inputTensor = new onnx.Tensor('float32', imageData, [1, channels, height, width]);
    const results = await this.session.run({ image: inputTensor });
    const confidences = [];
    let text = '';

    for (let position = 0; position < this.metadata.output_positions; position++) {
      const probabilities = results[`position_${position}`].data;
      let maxIndex = 0;
      let maxProbability = -Infinity;

      for (let index = 0; index < probabilities.length; index++) {
        if (probabilities[index] > maxProbability) {
          maxProbability = probabilities[index];
          maxIndex = index;
        }
      }

      text += this.metadata.idx_to_char[String(maxIndex)];
      confidences.push(maxProbability);
    }

    return {
      text,
      confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    };
  }
}

module.exports = new CaptchaSolver();
