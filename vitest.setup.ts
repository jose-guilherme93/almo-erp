/**
 * Setup dos testes.
 *
 * Carrega o `.env` local para os testes de integração que usam o banco.
 * No CI as variáveis já vêm do workflow — o `dotenv` não sobrescreve
 * variáveis já definidas no ambiente, então não há conflito.
 */
import "dotenv/config";
