import { SerialPort as UpstreamSerialPort } from "serialport";
import { PortInfo as UpstreamPortInfo } from "@serialport/bindings-cpp";

import { NodeSerial } from ".";
import { NodeSerialPortAdapter } from "./NodeSerialPortAdapter";
import { prompt } from "./NodePrompt";

export class NodeSerialAdapter extends EventTarget implements NodeSerial {
    onconnect: EventHandler;
    ondisconnect: EventHandler;

    protected selectedPorts: string[] = [];

    async listPorts(options?: SerialPortRequestOptions): Promise<NodeSerialPortAdapter[]> {
        const ports: NodeSerialPortAdapter[] = [];
        const portsInfo = await UpstreamSerialPort.list();

        for (const info of portsInfo) {
            ports.push(new NodeSerialPortAdapter(info));
        }

        return ports.filter(port => {
            return options?.filters
                ? options.filters.some(filter =>
                    filter.usbVendorId === port.getInfo().usbVendorId &&
                    (!filter.usbProductId || filter.usbProductId === port.getInfo().usbProductId)
                )
                : true;
        });
    }

    async findPort(portPath: string): Promise<SerialPort | undefined> {
        const ports = await this.listPorts();
        return ports.find(port => port.info_.path === portPath);
    }

    /**
     * In a browser: it returns connected ports that the site already has access to.
     * In Node.js: it returns all ports that the user has selected in requestPort();
     *
     * @returns the list of ports that the user has selected in requestPort();
     */
    async getPorts(): Promise<SerialPort[]> {
        return (await this.listPorts()).filter(port => this.selectedPorts.includes(port.info_.pnpId ?? ""));
    }

    async requestPort(options?: SerialPortRequestOptions): Promise<SerialPort> {
        const ports = await this.listPorts(options);

        console.log("\nPlease select a port.\n------------------------------");

        for (let i = 0; i < ports.length; i++) {
            const port = ports[i];
            const info = port.info_;
            const friendlyName: string | undefined = (info as UpstreamPortInfo & { friendlyName?: string }).friendlyName;

            if (friendlyName !== undefined)
                console.log(`${i}: ${friendlyName}`);
            else
                console.log(`${i}: ${info.serialNumber} - ${info.manufacturer} (${info.path})`);
        }

        if (ports.length === 0) {
            console.log("(no available ports)");
        }

        console.log("------------------------------");

        let ans: string;
        if (ports.length === 0) {
            ans = await prompt('Enter "r" to reload the list: ');
        } else if (ports.length === 1) {
            ans = await prompt(`Enter 0 to the port or "r" to reload the list: `);
        } else {
            ans = await prompt(`Enter 0 ~ ${ports.length - 1} to select a port or "r" to reload the list: `);
        }

        if (ans === 'r') {
            return this.requestPort(options);
        } else if (ans !== "" && ports[Number(ans)]) {
            const port = ports[Number(ans)];
            if (port.info_.pnpId !== undefined)
                this.selectedPorts.push(port.info_.pnpId);
            return port;
        }

        throw new Error("No port selected by the user.");
    }
}
