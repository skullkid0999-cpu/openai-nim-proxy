const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Verificaciones Iniciales ---
const NIM_API_KEY = process.env.NIM_API_KEY;
if (!NIM_API_KEY) {
  console.error("Error: La variable de entorno NIM_API_KEY no está definida.");
  process.exit(1); // <<< MEJORA: Falla rápido si falta la API key
}

app.use(cors());
app.use(express.json());

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';

const MODEL_MAPPING = {
  'deepseek-r1-0528': 'deepseek-ai/deepseek-r1-0528',
  'deepseek-v3.1': 'deepseek-ai/deepseek-v3.1',
  'deepseek-v3.1-terminus': 'deepseek-ai/deepseek-v3.1-terminus',
  'deepseek-v3.2': 'deepseek-ai/deepseek-v3.2',
  'GLM 4.7': 'z-ai/glm4.7'
  // Puedes añadir más modelos aquí
  // 'otro-modelo-openai': 'otro-modelo-nim'
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'OpenAI to NVIDIA NIM Proxy' });
});

app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Math.floor(Date.now() / 1000), // <<< MEJORA: Timestamp de Unix consistente
    owned_by: 'nvidia-nim-proxy'
  }));
  
  res.json({
    object: 'list',
    data: models
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, ...openAIParams } = req.body; // <<< MEJORA: Captura flexible de parámetros
    
    const nimModel = MODEL_MAPPING[model]; // <<< CORRECCIÓN: Mapeo dinámico del modelo
    
    if (!nimModel) { // <<< CORRECCIÓN: Validación del modelo
      return res.status(400).json({
        error: {
          message: `Model '${model}' is not supported by this proxy.`,
          type: 'invalid_request_error',
          code: 'model_not_found'
        }
      });
    }
    
    const nimRequest = {
      ...openAIParams,
      model: nimModel,
      stream: openAIParams.stream || false
    };
    
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: nimRequest.stream ? 'stream' : 'json'
    });
    
    if (nimRequest.stream) {
      res.setHeader('Content-Type', 'text/event-stream'); // Más estándar para SSE
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      response.data.pipe(res);
    } else {
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model, // Devuelve el modelo que el usuario solicitó
        choices: response.data.choices.map(choice => ({
          index: choice.index,
          message: choice.message,
          finish_reason: choice.finish_reason
        })),
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };
      
      res.json(openaiResponse);
    }
    
  } catch (error) {
    console.error('Proxy error:', error.message);
    
    res.status(error.response?.status || 500).json({
      error: {
        message: error.response?.data?.error?.message || error.message || 'Internal server error',
        type: 'invalid_request_error',
        code: error.response?.status || 500
      }
    });
  }
});

app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.path} not found on this proxy.`,
      type: 'invalid_request_error',
      code: 404
    }
  });
});

app.listen(PORT, () => {
  console.log(`OpenAI to NVIDIA NIM Proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log('Request body:', req.body);
  console.log('Mapped model:', nimModel);
  console.error('Error details:', error);
});
