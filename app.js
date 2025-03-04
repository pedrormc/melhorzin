// REQUERINDO MÓDULOS
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import * as eventosSocket from './bot/baileys/eventosSocket.js';
import { BotControle } from './bot/controles/BotControle.js';
import { MensagemControle } from './bot/controles/MensagemControle.js';
import configSocket from './bot/baileys/configSocket.js';
import moment from "moment-timezone";
import NodeCache from 'node-cache';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

moment.tz.setDefault('America/Sao_Paulo');

// Cache de tentativa de envios
const cacheTentativasEnvio = new NodeCache();
let sock = null; // Variável global para armazenar a conexão do WhatsApp

async function connectToWhatsApp() {
    let inicializacaoCompleta = false, eventosEsperando = [];
    const { state: estadoAuth, saveCreds } = await useMultiFileAuthState('sessao');
    let { version: versaoWaWeb } = await fetchLatestBaileysVersion();
    sock = makeWASocket(configSocket(estadoAuth, cacheTentativasEnvio, versaoWaWeb)); // Agora sock é global
    const bot = new BotControle();

    // Limpando mensagens armazenadas da sessão anterior
    await new MensagemControle().limparMensagensArmazenadas();

    // Escutando novos eventos
    sock.ev.process(async (events) => {
        // Obtendo dados do bot
        const botInfo = await bot.obterInformacoesBot();

        // Atualização na conexão
        if (events['connection.update']) {
            const update = events['connection.update'];
            const { connection } = update;
            let necessarioReconectar = false;
            if (connection === 'open') {
                await eventosSocket.conexaoAberta(sock, botInfo);
                inicializacaoCompleta = await eventosSocket.atualizacaoDadosGrupos(sock, botInfo);
                await eventosSocket.realizarEventosEspera(sock, eventosEsperando);
            } else if (connection === 'close') {
                necessarioReconectar = await eventosSocket.conexaoEncerrada(update, botInfo);
            }
            if (necessarioReconectar) connectToWhatsApp();
        }

        // Atualização nas credenciais
        if (events['creds.update']) {
            await saveCreds();
        }

        // Ao haver mudanças nos participantes de um grupo
        if (events['group-participants.update']) {
            const atualizacao = events['group-participants.update'];
            if (inicializacaoCompleta) await eventosSocket.atualizacaoParticipantesGrupo(sock, atualizacao, botInfo);
            else eventosEsperando.push({ evento: 'group-participants.update', dados: atualizacao });
        }

        // Ao atualizar dados do grupo
        if (events['groups.update']) {
            const grupos = events['groups.update'];
            if (grupos.length === 1 && grupos[0].participants === undefined) {
                if (inicializacaoCompleta) await eventosSocket.atualizacaoDadosGrupo(grupos[0]);
                else eventosEsperando.push({ evento: 'groups.update', dados: grupos });
            }
        }
    });
}

// Configuração do Servidor Express
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Função para remover um participante do grupo via API HTTP
async function removeUserFromGroup(groupId, participantId) {
    if (!sock) {
        console.error("❌ Erro: O bot ainda não está conectado ao WhatsApp.");
        return { success: false, message: "O bot ainda não está conectado ao WhatsApp." };
    }

    try {
        console.log(`🛑 Removendo usuário ${participantId} do grupo ${groupId}...`);
        const result = await sock.groupParticipantsUpdate(groupId, [participantId], "remove");
        console.log('✅ Usuário removido com sucesso:', result);
        return { success: true, message: 'Usuário removido com sucesso.' };
    } catch (error) {
        console.error('❌ Erro ao remover usuário:', error);
        return { success: false, message: error.message };
    }
}

// Criar um servidor HTTP para receber requisições POST
app.post('/remove', async (req, res) => {
    const { groupId, participantId } = req.body;

    if (!groupId || !participantId) {
        return res.status(400).json({ success: false, message: "groupId e participantId são obrigatórios." });
    }

    const result = await removeUserFromGroup(groupId, participantId);
    res.json(result);
});

// Iniciar o servidor Express na porta 3000
app.listen(3000, () => {
    console.log('🚀 Servidor HTTP rodando na porta 3000...');
});

// Execução principal
connectToWhatsApp();

