import readline from 'readline';
import util from 'util';

export const prompt: (question: string) => Promise<string> = (question: string) => {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
};