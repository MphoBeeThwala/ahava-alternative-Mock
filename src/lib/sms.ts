/**
 * SMS Notifications Service
 * Supports multiple providers: Africa's Talking, Twilio, Clickatell
 */

export interface SMSProvider {
  name: string;
  send(to: string, message: string): Promise<SMSResult>;
}

export interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface SMSConfig {
  provider: "africas_talking" | "twilio" | "clickatell";
  africasTalking?: {
    apiKey: string;
    username: string;
    from?: string;
  };
  twilio?: {
    accountSid: string;
    authToken: string;
    from: string;
  };
  clickatell?: {
    apiKey: string;
    from?: string;
  };
}

/**
 * Africa's Talking SMS Provider
 * Recommended for South African market
 */
export class AfricasTalkingProvider implements SMSProvider {
  name = "Africa's Talking";
  
  constructor(
    private apiKey: string,
    private username: string,
    private from?: string
  ) {}

  async send(to: string, message: string): Promise<SMSResult> {
    try {
      const response = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "apiKey": this.apiKey,
        },
        body: new URLSearchParams({
          username: this.username,
          to: this.formatPhoneNumber(to),
          message: message,
          ...(this.from && { from: this.from }),
        }),
      });

      const data = await response.json();

      if (response.ok && data.SMSMessageData?.Recipients?.[0]?.status === "Success") {
        return {
          success: true,
          messageId: data.SMSMessageData.Recipients[0].messageId,
        };
      }

      return {
        success: false,
        error: data.SMSMessageData?.Message || "Failed to send SMS",
      };
    } catch (error) {
      console.error("Africa's Talking SMS error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private formatPhoneNumber(phone: string): string {
    // Africa's Talking expects numbers in format: +27821234567
    if (!phone.startsWith("+")) {
      if (phone.startsWith("0")) {
        return `+27${phone.substring(1)}`;
      }
      return `+${phone}`;
    }
    return phone;
  }
}

/**
 * Twilio SMS Provider
 * International provider with good South African coverage
 */
export class TwilioProvider implements SMSProvider {
  name = "Twilio";
  
  constructor(
    private accountSid: string,
    private authToken: string,
    private from: string
  ) {}

  async send(to: string, message: string): Promise<SMSResult> {
    try {
      const auth = btoa(`${this.accountSid}:${this.authToken}`);
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: this.formatPhoneNumber(to),
            From: this.from,
            Body: message,
          }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        return {
          success: true,
          messageId: data.sid,
        };
      }

      return {
        success: false,
        error: data.message || "Failed to send SMS",
      };
    } catch (error) {
      console.error("Twilio SMS error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private formatPhoneNumber(phone: string): string {
    // Twilio expects E.164 format: +27821234567
    if (!phone.startsWith("+")) {
      if (phone.startsWith("0")) {
        return `+27${phone.substring(1)}`;
      }
      return `+${phone}`;
    }
    return phone;
  }
}

/**
 * Clickatell SMS Provider
 * South African provider with good local coverage
 */
export class ClickatellProvider implements SMSProvider {
  name = "Clickatell";
  
  constructor(
    private apiKey: string,
    private from?: string
  ) {}

  async send(to: string, message: string): Promise<SMSResult> {
    try {
      const response = await fetch("https://platform.clickatell.com/messages", {
        method: "POST",
        headers: {
          "Authorization": this.apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              to: [this.formatPhoneNumber(to)],
              text: message,
              ...(this.from && { from: this.from }),
            },
          ],
        }),
      });

      const data = await response.json();

      if (response.ok && data.messages?.[0]) {
        const msg = data.messages[0];
        if (msg.accepted) {
          return {
            success: true,
            messageId: msg.apiMessageId,
          };
        }
        return {
          success: false,
          error: msg.error || "Message not accepted",
        };
      }

      return {
        success: false,
        error: data.error?.description || "Failed to send SMS",
      };
    } catch (error) {
      console.error("Clickatell SMS error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private formatPhoneNumber(phone: string): string {
    // Clickatell expects format: 27821234567 (no +)
    if (phone.startsWith("+")) {
      return phone.substring(1);
    }
    if (phone.startsWith("0")) {
      return `27${phone.substring(1)}`;
    }
    return phone;
  }
}

/**
 * SMS Service Factory
 */
export function createSMSProvider(config: SMSConfig): SMSProvider {
  switch (config.provider) {
    case "africas_talking":
      if (!config.africasTalking) {
        throw new Error("Africa's Talking configuration missing");
      }
      return new AfricasTalkingProvider(
        config.africasTalking.apiKey,
        config.africasTalking.username,
        config.africasTalking.from
      );

    case "twilio":
      if (!config.twilio) {
        throw new Error("Twilio configuration missing");
      }
      return new TwilioProvider(
        config.twilio.accountSid,
        config.twilio.authToken,
        config.twilio.from
      );

    case "clickatell":
      if (!config.clickatell) {
        throw new Error("Clickatell configuration missing");
      }
      return new ClickatellProvider(
        config.clickatell.apiKey,
        config.clickatell.from
      );

    default:
      throw new Error(`Unsupported SMS provider: ${config.provider}`);
  }
}

/**
 * SMS Templates for Ahava Healthcare
 */
export const SMS_TEMPLATES = {
  APPOINTMENT_CONFIRMATION: (name: string, date: string, time: string) =>
    `Hi ${name}, your Ahava Healthcare appointment is confirmed for ${date} at ${time}. Reply CANCEL to cancel.`,

  APPOINTMENT_REMINDER: (name: string, time: string) =>
    `Reminder: Your Ahava appointment is in ${time}. See you soon!`,

  EMERGENCY_ALERT: (name: string, location: string) =>
    `EMERGENCY: ${name} has triggered an emergency alert at ${location}. Emergency services notified.`,

  PRESCRIPTION_READY: (name: string, pharmacy: string) =>
    `Hi ${name}, your prescription is ready for collection at ${pharmacy}. Valid for 30 days.`,

  PAYMENT_RECEIVED: (amount: string) =>
    `Payment of R${amount} received. Thank you for choosing Ahava Healthcare!`,

  NURSE_ASSIGNMENT: (name: string, nurseName: string, eta: string) =>
    `Hi ${name}, Nurse ${nurseName} has been assigned and will arrive in ${eta}.`,

  OTP_VERIFICATION: (code: string) =>
    `Your Ahava verification code is: ${code}. Valid for 10 minutes. Do not share this code.`,

  WELCOME: (name: string) =>
    `Welcome to Ahava Healthcare, ${name}! Download our app or visit ahava.co.za to get started.`,
};

/**
 * Send SMS notification
 */
export async function sendSMS(
  provider: SMSProvider,
  to: string,
  message: string
): Promise<SMSResult> {
  console.log(`Sending SMS via ${provider.name} to ${to}`);
  return await provider.send(to, message);
}

/**
 * Send multiple SMS messages (batch)
 */
export async function sendBulkSMS(
  provider: SMSProvider,
  recipients: Array<{ phone: string; message: string }>
): Promise<Array<SMSResult & { phone: string }>> {
  const results = await Promise.all(
    recipients.map(async (recipient) => {
      const result = await provider.send(recipient.phone, recipient.message);
      return {
        ...result,
        phone: recipient.phone,
      };
    })
  );

  return results;
}

